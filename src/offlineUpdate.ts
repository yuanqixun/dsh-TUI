import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gt, valid } from 'semver'
import { validateOfflineManifest, validateOfflineRuntimeConfig, type OfflinePlatform } from './offlineContracts.js'

export interface OfflineUpdateTarget {
  readonly kind: 'update' | 'latest' | 'unknown'
  readonly current?: string
  readonly latest?: string
  readonly releaseNotes?: string
  readonly assetUrl?: string
  readonly sizeBytes?: number
  readonly sha256?: string
}

interface OfflineConfig {
  schemaVersion: number
  distributionId: string
  platform: OfflinePlatform
  toolchainId: string
  modelApiBaseUrl: string
  manifestUrl: string
  maxUpdateBytes: number
  npmRegistry: string
  pythonIndexUrl: string
}

function offlineRoot(): string {
  const root = process.env.DSH_TUI_OFFLINE_ROOT
  if (root === undefined || !process.env.DSH_TUI_OFFLINE_HOME) throw new Error('Offline launcher environment is incomplete')
  return resolve(root)
}
function config(): OfflineConfig {
  const supplied = JSON.parse(readFileSync(join(offlineRoot(), 'config', 'offline.json'), 'utf8')) as unknown
  const value = validateOfflineRuntimeConfig(supplied)
  const distributionId = process.env.DSH_TUI_OFFLINE_DISTRIBUTION_ID
  const platform = process.env.DSH_TUI_OFFLINE_PLATFORM
  const toolchainId = process.env.DSH_TUI_OFFLINE_TOOLCHAIN_ID
  const manifestUrl = process.env.DSH_TUI_OFFLINE_MANIFEST_URL
  const modelApiBaseUrl = process.env.DSH_TUI_OFFLINE_MODEL_API_BASE_URL
  const maxUpdateBytes = Number(process.env.DSH_TUI_OFFLINE_MAX_UPDATE_BYTES)
  if (value.distributionId !== distributionId || value.platform !== platform || value.toolchainId !== toolchainId || value.manifestUrl !== manifestUrl || value.modelApiBaseUrl !== modelApiBaseUrl || !Number.isSafeInteger(maxUpdateBytes) || value.maxUpdateBytes !== maxUpdateBytes) throw new Error('Offline bundle configuration does not match this launcher')
  return value
}
function activeVersion(root: string): string {
  const pointer = JSON.parse(readFileSync(join(root, 'app', 'active.json'), 'utf8')) as { version?: unknown }
  if (typeof pointer.version !== 'string' || valid(pointer.version) === null) throw new Error('Active offline release pointer is invalid')
  return pointer.version
}
export function offlineUpdateErrorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object' && ['EACCES', 'EPERM', 'EROFS'].includes(String((error as { code?: unknown }).code))) {
    return 'the program directory is not writable; unpack the matching full offline bundle into a writable directory and launch it with the same DSH_TUI_OFFLINE_HOME to keep existing settings'
  }
  return error instanceof Error ? error.message : 'unknown error'
}
function releaseDirectory(root: string, version: string): string {
  const base = resolve(root, 'app', 'releases')
  const directory = resolve(base, version)
  if (!directory.startsWith(`${base}${sep}`)) throw new Error('Unsafe offline release path')
  return directory
}
async function fetchBytes(url: string, limit: number, timeoutMs: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!response.ok || response.body === null || new URL(response.url).origin !== new URL(url).origin) throw new Error('Offline update service returned an invalid response')
  const declaredHeader = response.headers.get('content-length')
  const declared = declaredHeader === null ? undefined : Number(declaredHeader)
  if (declared !== undefined && (!Number.isSafeInteger(declared) || declared > limit)) throw new Error('Offline update response exceeds the configured size limit')
  const chunks: Buffer[] = []
  let length = 0
  for await (const value of response.body) {
    const chunk = Buffer.from(value)
    length += chunk.length
    if (length > limit) throw new Error('Offline update response exceeds the configured size limit')
    chunks.push(chunk)
  }
  if (declared !== undefined && declared !== length) throw new Error('Offline update response length does not match its header')
  return Buffer.concat(chunks, length)
}

export async function resolveOfflineUpdateTarget(): Promise<OfflineUpdateTarget> {
  const current = await import('./update.js').then(module => module.installedTuiVersion())
  if (current === undefined || valid(current) === null) return { kind: 'unknown' }
  try {
    const settings = config()
    const manifestBytes = await fetchBytes(settings.manifestUrl, 1024 * 1024, 4000)
    let parsed: unknown
    try { parsed = JSON.parse(manifestBytes.toString('utf8')) } catch { throw new Error('Offline update manifest is invalid JSON') }
    const result = validateOfflineManifest(parsed, {
      manifestUrl: settings.manifestUrl,
      platform: settings.platform,
      toolchainId: settings.toolchainId,
      maxUpdateBytes: settings.maxUpdateBytes,
    })
    if (!('resolvedUrl' in result)) throw new Error('Offline update manifest has no platform asset')
    if (!gt(result.version, current)) return { kind: 'latest', current }
    return {
      kind: 'update',
      current,
      latest: result.version,
      releaseNotes: result.releaseNotes,
      assetUrl: result.resolvedUrl,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
    }
  } catch (error) {
    // Startup update checks never block the TUI; the manual /update path can retry.
    if (process.env.DSH_TUI_DEBUG === '1') {
      const reason = error instanceof Error ? error.message : 'unknown error'
      process.stderr.write(`dsh-tui offline update check failed: ${reason}\n`)
    }
    return { kind: 'unknown' }
  }
}

function verifyRelease(directory: string, expectedVersion: string, expectedToolchain: string): void {
  const value = JSON.parse(readFileSync(join(directory, 'offline-release.json'), 'utf8')) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Update archive has no release manifest')
  const release = value as { schemaVersion?: unknown; distributionId?: unknown; version?: unknown; toolchainId?: unknown; entry?: unknown; files?: unknown }
  if (release.schemaVersion !== 1 || release.distributionId !== config().distributionId || release.version !== expectedVersion || release.toolchainId !== expectedToolchain || typeof release.entry !== 'string' || release.files === null || typeof release.files !== 'object' || Array.isArray(release.files)) throw new Error('Update release metadata is incompatible')
  const listed = release.files as Record<string, unknown>
  const found: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Update archive contains an unsupported link')
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) {
        const relative = file.slice(directory.length + 1).split(sep).join('/')
        if (relative !== 'offline-release.json') found.push(relative)
      } else throw new Error('Update archive contains a special file')
    }
  }
  walk(directory)
  if (found.length !== Object.keys(listed).length) throw new Error(`Update archive file list is incomplete (${found.length} files found, ${Object.keys(listed).length} listed)`)
  for (const relative of found) {
    if (relative.startsWith('/') || relative.split('/').includes('..')) throw new Error('Update archive contains an unsafe path')
    const expected = listed[relative]
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/u.test(expected)) throw new Error('Update release digest is invalid')
    const actual = createHash('sha256').update(readFileSync(join(directory, ...relative.split('/')))).digest('hex')
    if (actual !== expected) throw new Error('Update release digest does not match')
  }
  if (!found.includes(release.entry) || !found.includes('cordis.patch.yml')) throw new Error('Update release is missing required files')
}

async function downloadUpdate(target: OfflineUpdateTarget): Promise<string> {
  if (target.kind !== 'update' || target.latest === undefined || target.assetUrl === undefined || target.sizeBytes === undefined || target.sha256 === undefined) throw new Error('No verified offline update is available')
  const settings = config()
  if (target.sizeBytes > settings.maxUpdateBytes) throw new Error('Update exceeds the configured size limit')
  const cache = join(process.env.DSH_TUI_OFFLINE_HOME!, 'cache', 'updates')
  mkdirSync(cache, { recursive: true })
  const archive = join(cache, `dsh-tui-${settings.platform}-${target.latest}-${randomUUID()}.${settings.platform === 'win10-x64' ? 'zip' : 'tar.gz'}`)
  const temporary = `${archive}.${randomUUID()}.part`
  const response = await fetch(target.assetUrl, { signal: AbortSignal.timeout(300_000), redirect: 'error' })
  if (!response.ok || response.body === null || new URL(response.url).origin !== new URL(settings.manifestUrl).origin) throw new Error('Offline update download failed')
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader)
  if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength !== target.sizeBytes)) throw new Error('Offline update size does not match the manifest')
  const hash = createHash('sha256')
  let received = 0
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    received += chunk.length
    if (received > target.sizeBytes! || received > settings.maxUpdateBytes) return callback(new Error('Offline update exceeded its declared size'))
    hash.update(chunk)
    callback(null, chunk)
  } })
  try {
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    if (received !== target.sizeBytes || hash.digest('hex') !== target.sha256.toLowerCase()) throw new Error('Offline update SHA-256 or size check failed')
    renameSync(temporary, archive)
    return archive
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

async function promptForUpdate(target: OfflineUpdateTarget): Promise<boolean | undefined> {
  if (target.kind !== 'update') return false
  const notes = (target.releaseNotes ?? '').slice(0, 2000)
  const message = `Install dsh-TUI ${target.latest}?\n\n${notes}\n\nType yes to download and install: `
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('dsh-tui offline: update not installed; run this command in an interactive terminal and confirm the update.\n')
    return undefined
  }
  const { createInterface } = await import('node:readline/promises')
  const input = createInterface({ input: process.stdin, output: process.stderr })
  try { return (await input.question(message)).trim().toLowerCase() === 'yes' }
  finally { input.close() }
}

export async function installOfflineUpdate(target: OfflineUpdateTarget): Promise<void> {
  if (target.kind !== 'update' || target.latest === undefined) throw new Error('No offline update is available')
  const settings = config()
  const root = offlineRoot()
  const base = join(root, 'app', 'releases')
  const activeFile = join(root, 'app', 'active.json')
  const previous = activeVersion(root)
  const destination = releaseDirectory(root, target.latest)
  if (existsSync(destination)) throw new Error('A release with this version already exists; remove it manually after reviewing the release directory')
  const staging = join(base, `.staging-${target.latest}-${randomUUID()}`)
  mkdirSync(staging, { recursive: false })
  let published = false
  let downloadedArchive: string | undefined
  try {
    const archive = await downloadUpdate(target)
    downloadedArchive = archive
    const python = process.platform === 'win32'
      ? join(root, 'tools', 'python', 'python.exe')
      : join(root, 'tools', 'python', 'bin', 'python3')
    const extractor = join(root, 'launcher', 'extract.py')
    const outcome = spawnSync(python, [extractor, settings.platform === 'win10-x64' ? 'zip' : 'tar.gz', archive, staging], { stdio: 'inherit' })
    if (outcome.error || outcome.status !== 0) throw new Error('Offline update archive could not be safely extracted')
    verifyRelease(staging, target.latest, settings.toolchainId)
    renameSync(staging, destination)
    published = true
    const pointerTemp = `${activeFile}.${randomUUID()}.tmp`
    writeFileSync(pointerTemp, `${JSON.stringify({ version: target.latest, previousVersion: previous }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(pointerTemp, activeFile)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (published && activeVersion(root) === previous) rmSync(destination, { recursive: true, force: true })
    throw error
  } finally {
    if (downloadedArchive !== undefined) {
      try { rmSync(downloadedArchive, { force: true }) } catch {}
    }
  }
}

export async function offlineCliUpdate(): Promise<number> {
  const target = await resolveOfflineUpdateTarget()
  if (target.kind === 'latest') {
    process.stdout.write(`dsh-tui: already the latest version (${target.current}).\n`)
    return 0
  }
  if (target.kind === 'unknown') {
    process.stderr.write('dsh-tui: unable to check the configured offline update service; no public registry fallback was attempted.\n')
    return 1
  }
  const confirmed = await promptForUpdate(target)
  if (confirmed === undefined) return 1
  if (!confirmed) {
    process.stdout.write('dsh-tui: update cancelled.\n')
    return 0
  }
  try {
    await installOfflineUpdate(target)
    process.stdout.write(`dsh-tui: installed ${target.latest}; the new version starts next time.\n`)
    return 0
  } catch (error) {
    process.stderr.write(`dsh-tui: offline update failed: ${offlineUpdateErrorMessage(error)}\n`)
    return 1
  }
}
