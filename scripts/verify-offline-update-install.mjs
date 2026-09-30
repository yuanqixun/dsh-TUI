#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'verify-offline-install-'))
const app = join(root, 'app')
const releases = join(app, 'releases')
const activePath = join(app, 'active.json')
const data = join(tmpdir(), `verify-offline-data-${process.pid}`)
const config = {
  schemaVersion: 1,
  distributionId: 'hxfl',
  platform: 'kylin-v10-x64',
  toolchainId: 'hxfl-kylin-v10-x64-tools-test',
  modelApiBaseUrl: 'https://model.corp.example/v1',
  manifestUrl: 'https://updates.corp.example/dsh-tui/manifest.json',
  maxUpdateBytes: 1024 * 1024,
  npmRegistry: 'https://npm.corp.example',
  pythonIndexUrl: 'https://pypi.corp.example/simple/',
}
const envKeys = [
  'DSH_TUI_OFFLINE', 'DSH_TUI_OFFLINE_DISTRIBUTION_ID', 'DSH_TUI_OFFLINE_ROOT', 'DSH_TUI_OFFLINE_HOME',
  'DSH_TUI_OFFLINE_PLATFORM', 'DSH_TUI_OFFLINE_TOOLCHAIN_ID', 'DSH_TUI_OFFLINE_MANIFEST_URL',
  'DSH_TUI_OFFLINE_MODEL_API_BASE_URL', 'DSH_TUI_OFFLINE_MAX_UPDATE_BYTES',
]
const savedEnvironment = new Map(envKeys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const originalPythonPath = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim()

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function updateTarget(version, archive, sha256 = digest(archive)) {
  return {
    kind: 'update',
    current: '0.11.1',
    latest: version,
    assetUrl: `https://updates.corp.example/dsh-tui/${version}.tar.gz`,
    sizeBytes: archive.length,
    sha256,
  }
}

function mockedArchiveFetch(bytes, url) {
  return async input => {
    assert.equal(String(input), url)
    const response = new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
}

try {
  mkdirSync(join(releases, '0.11.1'), { recursive: true })
  mkdirSync(join(root, 'tools', 'python', 'bin'), { recursive: true })
  mkdirSync(join(root, 'launcher'), { recursive: true })
  mkdirSync(join(data, 'dsh', 'profiles', 'dsh-tui'), { recursive: true })
  writeFileSync(join(releases, '0.11.1', 'offline-release.json'), '{}\n')
  writeFileSync(join(root, 'tools', 'node-version.txt'), 'bundled-node-stays-unchanged\n')
  writeFileSync(join(root, 'tools', 'git-version.txt'), 'bundled-git-stays-unchanged\n')
  writeFileSync(join(root, 'tools', 'python-version.txt'), 'bundled-python-stays-unchanged\n')
  writeFileSync(join(data, 'dsh', 'profiles', 'dsh-tui', 'credentials.json'), 'user-data-stays-unchanged\n')
  writeFileSync(activePath, `${JSON.stringify({ version: '0.11.1' }, null, 2)}\n`)
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(join(root, 'config', 'offline.json'), `${JSON.stringify(config, null, 2)}\n`)
  symlinkSync(originalPythonPath, join(root, 'tools', 'python', 'bin', 'python3'))
  writeFileSync(join(root, 'launcher', 'extract.py'), readFileSync(new URL('./offline/extract.py', import.meta.url)))
  Object.assign(process.env, {
    DSH_TUI_OFFLINE: '1',
    DSH_TUI_OFFLINE_DISTRIBUTION_ID: config.distributionId,
    DSH_TUI_OFFLINE_ROOT: root,
    DSH_TUI_OFFLINE_HOME: data,
    DSH_TUI_OFFLINE_PLATFORM: config.platform,
    DSH_TUI_OFFLINE_TOOLCHAIN_ID: config.toolchainId,
    DSH_TUI_OFFLINE_MANIFEST_URL: config.manifestUrl,
    DSH_TUI_OFFLINE_MODEL_API_BASE_URL: config.modelApiBaseUrl,
    DSH_TUI_OFFLINE_MAX_UPDATE_BYTES: String(config.maxUpdateBytes),
  })

  const fixture = mkdtempSync(join(tmpdir(), 'offline-release-fixture-'))
  const releaseFiles = {
    'index.js': "process.send?.({ type: 'dsh-tui-offline-ready' })\n",
    'cordis.patch.yml': 'plugins: []\n',
  }
  for (const [name, contents] of Object.entries(releaseFiles)) writeFileSync(join(fixture, name), contents)
  const releaseManifest = {
    schemaVersion: 1,
    distributionId: config.distributionId,
    version: '0.11.2',
    toolchainId: config.toolchainId,
    entry: 'index.js',
    files: Object.fromEntries(Object.entries(releaseFiles).map(([name, contents]) => [name, digest(Buffer.from(contents))])),
  }
  writeFileSync(join(fixture, 'offline-release.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`)
  const validArchivePath = join(root, 'valid-update.tar.gz')
  execFileSync('tar', ['-czf', validArchivePath, '-C', fixture, 'index.js', 'cordis.patch.yml', 'offline-release.json'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const validArchive = readFileSync(validArchivePath)
  rmSync(fixture, { recursive: true, force: true })

  const { installOfflineUpdate, offlineCliUpdate, offlineUpdateErrorMessage } = await import('../src/offlineUpdate.ts')
  const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  assert.match(offlineUpdateErrorMessage(permissionError), /unpack the matching full offline bundle into a writable directory/u)
  const validTarget = updateTarget('0.11.2', validArchive)

  const manifestAsset = {
    url: './0.11.2.tar.gz',
    sizeBytes: validArchive.length,
    sha256: digest(validArchive),
    requiredToolchainId: config.toolchainId,
  }
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    version: '0.11.2',
    sourceCommit: 'a'.repeat(40),
    publishedAt: '2026-09-30T00:00:00Z',
    releaseNotes: 'Offline install fixture',
    platforms: { 'kylin-v10-x64': manifestAsset },
  }))
  const requestedUrls = []
  globalThis.fetch = async input => {
    const url = String(input)
    requestedUrls.push(url)
    assert.equal(url, config.manifestUrl, 'a declined update must not request its archive')
    const response = new Response(manifestBytes, { headers: { 'content-length': String(manifestBytes.length) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const fakeInput = Readable.from(['no\n'])
  Object.defineProperty(fakeInput, 'isTTY', { configurable: true, value: true })
  Object.defineProperty(process, 'stdin', { configurable: true, enumerable: true, value: fakeInput })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  try {
    assert.equal(await offlineCliUpdate(), 0)
  } finally {
    Object.defineProperty(process, 'stdin', stdinDescriptor)
    if (stdoutIsTTYDescriptor === undefined) delete process.stdout.isTTY
    else Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor)
  }
  assert.deepEqual(requestedUrls, [config.manifestUrl])

  globalThis.fetch = mockedArchiveFetch(validArchive, validTarget.assetUrl)
  await installOfflineUpdate(validTarget)
  assert.deepEqual(JSON.parse(readFileSync(activePath, 'utf8')), { version: '0.11.2', previousVersion: '0.11.1' })
  assert.equal(readFileSync(join(releases, '0.11.2', 'index.js'), 'utf8'), releaseFiles['index.js'])
  assert.equal(readFileSync(join(root, 'tools', 'node-version.txt'), 'utf8'), 'bundled-node-stays-unchanged\n')
  assert.equal(readFileSync(join(root, 'tools', 'git-version.txt'), 'utf8'), 'bundled-git-stays-unchanged\n')
  assert.equal(readFileSync(join(root, 'tools', 'python-version.txt'), 'utf8'), 'bundled-python-stays-unchanged\n')
  assert.equal(readFileSync(join(data, 'dsh', 'profiles', 'dsh-tui', 'credentials.json'), 'utf8'), 'user-data-stays-unchanged\n')

  const badDigestTarget = updateTarget('0.11.3', validArchive, '0'.repeat(64))
  globalThis.fetch = mockedArchiveFetch(validArchive, badDigestTarget.assetUrl)
  await assert.rejects(installOfflineUpdate(badDigestTarget), /SHA-256 or size check failed/u)
  assert.deepEqual(JSON.parse(readFileSync(activePath, 'utf8')), { version: '0.11.2', previousVersion: '0.11.1' })
  assert.equal(readdirSync(releases).some(name => name.startsWith('.staging-0.11.3-')), false)

  const malformedArchive = Buffer.from('not a tar archive')
  const malformedTarget = updateTarget('0.11.3', malformedArchive)
  globalThis.fetch = mockedArchiveFetch(malformedArchive, malformedTarget.assetUrl)
  await assert.rejects(installOfflineUpdate(malformedTarget), /could not be safely extracted/u)
  assert.deepEqual(JSON.parse(readFileSync(activePath, 'utf8')), { version: '0.11.2', previousVersion: '0.11.1' })
  assert.equal(readdirSync(releases).some(name => name.startsWith('.staging-0.11.3-')), false)

  chmodSync(releases, 0o555)
  let downloaded = false
  globalThis.fetch = async () => { downloaded = true; throw new Error('fetch must not run for a read-only installation') }
  try {
    await assert.rejects(installOfflineUpdate(updateTarget('0.11.3', validArchive)), error => ['EACCES', 'EPERM', 'EROFS'].includes(error?.code))
  } finally {
    chmodSync(releases, 0o755)
  }
  assert.equal(downloaded, false)
  assert.deepEqual(JSON.parse(readFileSync(activePath, 'utf8')), { version: '0.11.2', previousVersion: '0.11.1' })

  process.stdout.write('offline update install verified (decline without download, archive SHA and extraction, active release switch, tool/data preservation, failed update safety, read-only preflight)\n')
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
}
