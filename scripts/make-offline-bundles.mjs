#!/usr/bin/env node
/** Build full offline bundles and client-only update archives from locked inputs. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { release as osRelease, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOfflineBuildConfig, validateOfflineManifest, OFFLINE_PLATFORMS } from '../lib/types/offlineContracts.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = packageJson.version
const args = process.argv.slice(2)
const options = new Map()
for (let index = 0; index < args.length; index += 1) {
  const key = args[index]
  if (!['--profile', '--out', '--platform'].includes(key) || args[index + 1] === undefined || args[index + 1].startsWith('--') || options.has(key)) throw new Error('Usage: pnpm offline:build -- --profile superbpm|hxfl --platform <target> [--out <empty-directory>]')
  options.set(key, args[++index])
}
const distributionId = options.get('--profile')
if (distributionId !== 'superbpm' && distributionId !== 'hxfl') throw new Error('Specify a package profile: --profile superbpm|hxfl')
const configPath = join(root, 'offline', 'profiles', `${distributionId}.json`)
const targetPlatform = options.get('--platform')
if (!OFFLINE_PLATFORMS.includes(targetPlatform)) throw new Error('Unknown offline target platform')
let config
try {
  const bytes = readFileSync(configPath)
  if (bytes.length > 1024 * 1024) throw new Error()
  config = validateOfflineBuildConfig(JSON.parse(bytes.toString('utf8')))
  if (config.distributionId !== distributionId) throw new Error()
} catch {
  throw new Error(`Create offline/profiles/${distributionId}.json from its example and fill the locked toolchain inputs`)
}
const hostPlatform = process.platform === 'win32' && process.arch === 'x64'
  ? 'win10-x64'
  : process.platform === 'linux' && process.arch === 'x64'
    ? 'kylin-v10-x64'
    : process.platform === 'linux' && process.arch === 'arm64'
      ? 'kylin-v10-arm64'
      : undefined
if (hostPlatform !== targetPlatform) throw new Error('Build each client on its matching target OS and architecture so native dependencies match the archive')
if (targetPlatform === 'win10-x64') {
  const build = Number(osRelease().split('.')[2])
  if (!Number.isInteger(build) || build < 10240 || build >= 22000) throw new Error('Windows client builds must run on Windows 10 x64')
}
if (targetPlatform.startsWith('kylin-')) {
  const osRelease = readFileSync('/etc/os-release', 'utf8')
  if (!/^ID=(?:"?kylin"?|"?kylin-server"?)$/imu.test(osRelease) || !/^VERSION_ID=.*(?:V?10|10\.)/imu.test(osRelease)) throw new Error('Linux client builds must run on the exact Kylin V10 target baseline')
}
const output = resolve(options.get('--out') ?? join(root, 'dist-offline', distributionId, targetPlatform, version))
if (output === root) throw new Error('Output directory must not be the repository root')
if (existsSync(output)) throw new Error('Output directory already exists; choose an empty path so existing files stay untouched')
if (!config.toolchains || OFFLINE_PLATFORMS.some(platform => !config.toolchains[platform])) throw new Error('Toolchain inputs are required for all three target platforms')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40,64}$/u.test(sourceCommit)) throw new Error('Could not resolve the source commit')
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim() !== '') throw new Error('Offline release builds require a clean, committed source tree')

function hashFile(path) {
  const descriptor = openSync(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const size = fstatSync(descriptor).size
    for (let position = 0; position < size;) {
      const length = readSync(descriptor, buffer, 0, Math.min(buffer.length, size - position), position)
      if (length === 0) throw new Error('Unexpected end of file while hashing offline input')
      hash.update(buffer.subarray(0, length))
      position += length
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}
function hashTree(directory, { toolchain = false } = {}) {
  const output = {}
  const rootPath = realpathSync(directory)
  const walk = (current, logical, ancestors) => {
    const realCurrent = realpathSync(current)
    if (ancestors.includes(realCurrent)) throw new Error('A release tree contains a directory-link cycle')
    const nextAncestors = [...ancestors, realCurrent]
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.bin') continue
      const path = join(current, entry.name)
      const virtualPath = join(logical, entry.name)
      const relativePath = virtualPath.split(sep).join('/')
      if (toolchain && (relativePath === 'manifest.json' || relativePath.startsWith('sources/'))) continue
      const realPath = entry.isSymbolicLink() && toolchain ? realpathSync(path) : path
      if (entry.isSymbolicLink() && !toolchain) throw new Error('A release tree contains a symbolic link')
      const realRelative = relative(rootPath, realPath)
      if (realRelative.startsWith('..') || isAbsolute(realRelative)) throw new Error('A tool symlink resolves outside its locked tool directory')
      const metadata = statSync(realPath)
      if (metadata.isDirectory()) walk(realPath, virtualPath, nextAncestors)
      else if (metadata.isFile()) output[relativePath] = hashFile(realPath)
      else throw new Error('A release tree contains a special file')
    }
  }
  walk(directory, '', [])
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)))
}
function json(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options })
}
function toolchainFor(platform) {
  const toolchain = config.toolchains[platform]
  const sourceDirectory = resolve(root, toolchain.sourceDirectory)
  if (sourceDirectory === root || !sourceDirectory.startsWith(`${root}${sep}`) || !existsSync(sourceDirectory) || !statSync(sourceDirectory).isDirectory()) throw new Error(`Toolchain source directory for ${platform} is missing or outside the repository`)
  const realSourceDirectory = realpathSync(sourceDirectory)
  if (realSourceDirectory === root || !realSourceDirectory.startsWith(`${root}${sep}`)) throw new Error(`Toolchain source directory for ${platform} resolves outside the repository`)
  for (const name of ['node', 'git', 'python', 'LICENSES']) if (!existsSync(join(sourceDirectory, name))) throw new Error(`Toolchain ${platform} is missing ${name}/`)
  if (/待|填写|TODO|example\.(?:invalid|com|org|net)/iu.test(`${toolchain.id} ${toolchain.nodeVersion} ${toolchain.gitVersion} ${toolchain.pythonVersion} ${toolchain.platformBaseline}`)) throw new Error(`Toolchain ${platform} still contains an example or unverified value`)
  const windows = platform === 'win10-x64'
  const executables = {
    node: join(sourceDirectory, 'node', windows ? 'node.exe' : 'bin/node'),
    git: join(sourceDirectory, 'git', windows ? 'cmd/git.exe' : 'bin/git'),
    python: join(sourceDirectory, 'python', windows ? 'python.exe' : 'bin/python3'),
  }
  for (const [name, path] of Object.entries(executables)) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Toolchain ${platform} is missing its ${name} executable`)
  }
  if (windows && !existsSync(join(sourceDirectory, 'git', 'usr', 'bin', 'bash.exe'))) throw new Error('Windows toolchain is missing Git Bash')
  const actualVersions = {
    node: execFileSync(executables.node, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/u, ''),
    git: execFileSync(executables.git, ['--version'], { encoding: 'utf8' }).trim().replace(/^git version /u, ''),
    python: execFileSync(executables.python, ['--version'], { encoding: 'utf8' }).trim().replace(/^Python /u, ''),
  }
  for (const [name, expected] of Object.entries({ node: toolchain.nodeVersion, git: toolchain.gitVersion, python: toolchain.pythonVersion })) {
    if (actualVersions[name] !== expected.replace(/^v/u, '')) throw new Error(`Toolchain ${platform} ${name} version does not match its declared version`)
  }
  const sourceManifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8'))
  const files = hashTree(sourceDirectory, { toolchain: true })
  const metadata = {
    platform,
    id: toolchain.id,
    nodeVersion: toolchain.nodeVersion,
    gitVersion: toolchain.gitVersion,
    pythonVersion: toolchain.pythonVersion,
    platformBaseline: toolchain.platformBaseline,
    sourceArchives: sourceManifest.sourceArchives,
    licenses: sourceManifest.licenses,
  }
  if (!sourceManifest.licenses || typeof sourceManifest.licenses !== 'object' || Array.isArray(sourceManifest.licenses) || Object.keys(sourceManifest.licenses).sort().join(',') !== 'git,node,python' || Object.values(sourceManifest.licenses).some(value => typeof value !== 'string' || !value)) throw new Error(`Locked toolchain ${platform} lacks license declarations`)
  if (sourceManifest.schemaVersion !== 1 || sourceManifest.platform !== platform || sourceManifest.id !== toolchain.id || sourceManifest.nodeVersion !== toolchain.nodeVersion || sourceManifest.gitVersion !== toolchain.gitVersion || sourceManifest.pythonVersion !== toolchain.pythonVersion || sourceManifest.platformBaseline !== toolchain.platformBaseline || JSON.stringify(sourceManifest.files) !== JSON.stringify(files)) throw new Error(`Locked toolchain metadata does not match inputs for ${platform}`)
  if (!sourceManifest.sourceArchives || Object.keys(sourceManifest.sourceArchives).sort().join(',') !== 'git,node,python') throw new Error(`Toolchain ${platform} lacks source archive hashes`)
  for (const name of ['node', 'git', 'python']) {
    const archive = sourceManifest.sourceArchives[name]
    if (!archive || typeof archive.file !== 'string' || !/^[0-9a-f]{64}$/iu.test(archive.sha256 ?? '') || isAbsolute(archive.file) || archive.file.split(/[\\/]/u).includes('..')) throw new Error(`Toolchain ${platform} has an invalid source archive record`)
    const path = resolve(sourceDirectory, archive.file)
    const realPath = existsSync(path) ? realpathSync(path) : path
    const relativePath = relative(realSourceDirectory, realPath)
    if (relativePath.startsWith('..') || isAbsolute(relativePath) || !existsSync(path) || lstatSync(path).isSymbolicLink() || hashFile(path) !== archive.sha256.toLowerCase()) throw new Error(`Toolchain ${platform} source archive hash does not match`)
  }
  const contentHash = createHash('sha256').update(JSON.stringify({ ...metadata, files })).digest('hex').slice(0, 12)
  return { ...toolchain, sourceDirectory, sourceManifest, toolchainId: `${toolchain.id}-${contentHash}`, files }
}
function copyTree(source, destination, { flattenLinks = false, linkRoot = source, stripDeployMetadata = false } = {}) {
  const realLinkRoot = realpathSync(linkRoot)
  const nodeModulesRoot = join(source, 'node_modules')
  const copy = (from, to, ancestors = []) => {
    const realFrom = realpathSync(from)
    if (ancestors.includes(realFrom)) {
      if (flattenLinks) return
      throw new Error('Release tree contains a directory-link cycle')
    }
    const nextAncestors = [...ancestors, realFrom]
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name === '.bin') continue
      if (stripDeployMetadata && from === nodeModulesRoot && ['.pnpm', '.modules.yaml', '.package-map.json'].includes(entry.name)) continue
      const input = join(from, entry.name)
      const target = join(to, entry.name)
      if (entry.isSymbolicLink() && !flattenLinks) throw new Error(`Release tree contains a symbolic link: ${entry.name}`)
      const realInput = entry.isSymbolicLink() ? realpathSync(input) : input
      if (flattenLinks) {
        const realRelative = relative(realLinkRoot, realInput)
        if (realRelative.startsWith('..') || isAbsolute(realRelative)) throw new Error('A tool symlink resolves outside its locked tool directory')
      }
      const metadata = statSync(realInput)
      if (metadata.isDirectory()) copy(realInput, target, nextAncestors)
      else if (metadata.isFile()) copyFileSync(realInput, target, 0)
      else throw new Error(`Toolchain contains a special file: ${entry.name}`)
    }
  }
  copy(source, destination)
}
function replaceWorkspacePackage(runtime, packageName, source, directories) {
  const destination = join(runtime, 'node_modules', ...packageName.split('/'))
  if (!lstatExists(destination)) throw new Error(`Production deploy omitted workspace package ${packageName}`)
  const expectedSource = realpathSync(source)
  if (realpathSync(destination) !== expectedSource) throw new Error(`Production deploy resolved an unexpected workspace path for ${packageName}`)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: false })
  copyFileSync(join(source, 'package.json'), join(destination, 'package.json'))
  for (const name of directories) {
    const input = join(source, name)
    if (!existsSync(input)) continue
    const output = join(destination, name)
    if (statSync(input).isDirectory()) copyTree(input, output, { flattenLinks: true, linkRoot: source })
    else if (statSync(input).isFile()) copyFileSync(input, output)
    else throw new Error(`Workspace package contains an unsupported entry: ${packageName}/${name}`)
  }
  for (const name of ['LICENSE', 'LICENCE', 'NOTICE']) {
    const input = join(source, name)
    if (existsSync(input) && statSync(input).isFile()) copyFileSync(input, join(destination, name))
  }
}
function lstatExists(path) {
  try { lstatSync(path); return true } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}
function findNodePackage(modules, packageName) {
  if (!existsSync(modules)) return undefined
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.pnpm') continue
    const packagePath = join(modules, entry.name)
    if (entry.name === packageName && existsSync(join(packagePath, 'package.json'))) return packagePath
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(packagePath, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue
        const scopedPath = join(packagePath, scoped.name)
        if (scoped.name === packageName && existsSync(join(scopedPath, 'package.json'))) return scopedPath
        const nested = findNodePackage(join(scopedPath, 'node_modules'), packageName)
        if (nested !== undefined) return nested
      }
    } else {
      const nested = findNodePackage(join(packagePath, 'node_modules'), packageName)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}
function copyToolchain(tools, destination) {
  for (const name of ['node', 'git', 'python', 'LICENSES']) copyTree(join(tools.sourceDirectory, name), join(destination, name), { flattenLinks: true, linkRoot: tools.sourceDirectory })
  json(join(destination, 'manifest.json'), { ...tools.sourceManifest, toolchainId: tools.toolchainId, files: tools.files })
}
function collectPackageLicenses(app) {
  const packages = []
  const licenses = join(app, 'LICENSES', 'npm')
  mkdirSync(licenses, { recursive: true })
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.name === '.bin') continue
      if (entry.isSymbolicLink()) throw new Error('Production dependency tree contains a link; use a flat deploy layout')
      if (!entry.isDirectory()) continue
      if (entry.name === '.bin') continue
      if (entry.name.startsWith('@')) { visit(path); continue }
      const manifestPath = join(path, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error('Production dependency has unreadable package metadata')
        const relativePath = relative(join(app, 'node_modules'), path).split(sep).join('/')
        const slug = `${manifest.name.replace(/[^A-Za-z0-9._-]/gu, '_')}-${manifest.version}-${createHash('sha256').update(relativePath).digest('hex').slice(0, 8)}`
        const packageLicenseDir = join(licenses, slug)
        const licenseFiles = readdirSync(path, { withFileTypes: true }).filter(file => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:\.|$)/iu.test(file.name))
        for (const license of licenseFiles) {
          const source = join(path, license.name)
          if (statSync(source).size > 16 * 1024 * 1024) throw new Error(`Oversized third-party license file: ${manifest.name}`)
          mkdirSync(packageLicenseDir, { recursive: true })
          copyFileSync(source, join(packageLicenseDir, license.name))
        }
        packages.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? manifest.licenses ?? 'UNDECLARED', files: licenseFiles.map(file => `LICENSES/npm/${slug}/${file.name}`) })
      }
      const nestedModules = join(path, 'node_modules')
      if (existsSync(nestedModules)) visit(nestedModules)
    }
  }
  visit(join(app, 'node_modules'))
  writeFileSync(join(app, 'LICENSES', 'npm-packages.json'), `${JSON.stringify(packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), null, 2)}\n`, { flag: 'wx' })
}
function archive(kind, source, path, python) {
  run(python, [join(root, 'scripts', 'offline', 'archive.py'), kind, source, path])
}
function packageVersions(app) {
  const reads = [
    ['tui', '@deepseek-harness-tui/dsh-tui'],
    ['dsh', '@deepseek-ai/dsh'],
    ['dshWebApp', '@deepseek-ai/dsh-web-app'],
    ['schemastery', '@deepseek-ai/schemastery'],
    ['dshAuth', '@deepseek-harness-tui/dsh-auth'],
  ]
  return Object.fromEntries(reads.map(([key, name]) => {
    const manifest = JSON.parse(readFileSync(join(app, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
    return [key, { name, version: manifest.version }]
  }))
}

const scratch = join(tmpdir(), `dsh-tui-offline-${process.pid}-${Date.now()}`)
const outputStaging = `${output}.staging-${process.pid}-${Date.now()}`
mkdirSync(scratch, { recursive: false })
try {
  const platforms = [targetPlatform]
  const runtimes = new Map(platforms.map(platform => [platform, toolchainFor(platform)]))
  // The package entry point builds first; deploy then consumes the committed
  // lock graph and local dsh-auth/dsh-std workspace packages.
  run('pnpm', ['--filter', '@dsh-tui-dev/offline-runtime', 'deploy', '--prod', '--legacy', '--ignore-scripts', join(scratch, 'runtime')])
  const runtime = join(scratch, 'runtime')
  replaceWorkspacePackage(runtime, '@deepseek-harness-tui/dsh-tui', root, [
    'bin', 'lib', 'assets', 'cordis.patch.yml', 'cordis.yml',
    'dsh-ecosystem-spec/registry', 'dsh-ecosystem-spec/protocols', 'dsh-ecosystem-spec/schemas', 'presets',
  ])
  replaceWorkspacePackage(runtime, '@deepseek-harness-tui/dsh-auth', join(root, 'dsh-auth'), [
    'lib', 'dsh-plugin.json', 'cordis.patch.yml', 'README.md',
  ])
  for (const name of ['core', 'manifest', 'connection', 'presentation', 'command', 'storage', 'messages']) {
    replaceWorkspacePackage(runtime, `@dsh-std/${name}`, join(root, 'vendor', 'dsh-std', 'packages', name), ['lib'])
  }
  mkdirSync(dirname(output), { recursive: true })
  mkdirSync(outputStaging, { recursive: false })
  const manifest = {
    schemaVersion: 1,
    version,
    sourceCommit,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    releaseNotes: config.releaseNotes,
    platforms: {},
  }
  for (const platform of platforms) {
    const tools = runtimes.get(platform)
    const work = join(scratch, platform)
    const client = join(work, 'client')
    mkdirSync(client, { recursive: true })
    // The update archive contains only the client release and runtime deps.
    const releaseSource = runtime
    copyTree(releaseSource, client, { flattenLinks: true, linkRoot: releaseSource, stripDeployMetadata: true })
    const ptyPlatform = platform === 'win10-x64' ? 'win32-x64' : platform === 'kylin-v10-x64' ? 'linux-x64' : 'linux-arm64'
    const ptyRoot = findNodePackage(join(client, 'node_modules'), 'node-pty')
    if (ptyRoot === undefined) throw new Error('Production dependency tree omitted node-pty')
    const ptyBinary = join(ptyRoot, 'prebuilds', ptyPlatform, platform === 'win10-x64' ? 'conpty.node' : 'pty.node')
    if (!existsSync(ptyBinary)) throw new Error(`Production dependencies lack the node-pty prebuild for ${platform}`)
    if (platform.startsWith('kylin-')) {
      const helper = join(ptyRoot, 'prebuilds', ptyPlatform, 'spawn-helper')
      if (!existsSync(helper)) throw new Error(`Production dependencies lack the node-pty spawn helper for ${platform}`)
      chmodSync(helper, 0o755)
    }
    collectPackageLicenses(client)
    const tuiPackage = join(client, 'node_modules', '@deepseek-harness-tui', 'dsh-tui')
    copyFileSync(join(tuiPackage, 'cordis.patch.yml'), join(client, 'cordis.patch.yml'))
    const versions = packageVersions(client)
    const entry = 'node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js'
    if (!existsSync(join(client, entry))) throw new Error('Production deploy omitted the dsh-tui launcher')
    const toolchainId = tools.toolchainId
    json(join(client, 'offline-release.json'), {
      schemaVersion: 1,
      distributionId: config.distributionId,
      version,
      sourceCommit,
      platform,
      toolchainId,
      platformBaseline: tools.platformBaseline,
      packages: versions,
      entry,
      files: hashTree(client),
      licenseDirectory: 'LICENSES',
    })
    const updateArchive = join(outputStaging, `dsh-tui-${config.distributionId}-${version}-${platform}.${platform === 'win10-x64' ? 'zip' : 'tar.gz'}`)
    const hostPython = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
    archive(platform === 'win10-x64' ? 'zip' : 'tar.gz', client, updateArchive, hostPython)
    const updateStat = statSync(updateArchive)
    if (updateStat.size > config.maxUpdateBytes) throw new Error(`Client update exceeds maxUpdateBytes for ${platform}`)
    manifest.platforms[platform] = {
      url: `./${basename(updateArchive)}`,
      sizeBytes: updateStat.size,
      sha256: hashFile(updateArchive),
      requiredToolchainId: toolchainId,
    }
    releaseInfos.set(platform, { toolchainId, versions })

    const bundle = join(work, 'bundle')
    mkdirSync(bundle, { recursive: true })
    mkdirSync(join(bundle, 'app', 'releases'), { recursive: true })
    copyTree(client, join(bundle, 'app', 'releases', version))
    json(join(bundle, 'app', 'active.json'), { version })
    copyToolchain(tools, join(bundle, 'tools'))
    mkdirSync(join(bundle, 'config'), { recursive: true })
    json(join(bundle, 'config', 'offline.json'), {
      schemaVersion: 1,
      distributionId: config.distributionId,
      platform,
      toolchainId,
      modelApiBaseUrl: config.modelApiBaseUrl,
      manifestUrl: config.manifestUrl,
      maxUpdateBytes: config.maxUpdateBytes,
      npmRegistry: config.npmRegistry,
      pythonIndexUrl: config.pythonIndexUrl,
      versions,
      releaseNotes: config.releaseNotes,
    })
    writeFileSync(join(bundle, 'config', 'npmrc'), `registry=${config.npmRegistry}\nreplace-registry-host=always\n`, { flag: 'wx', mode: 0o600 })
    const pipFile = platform === 'win10-x64' ? 'pip.ini' : 'pip.conf'
    writeFileSync(join(bundle, 'config', pipFile), `[global]\nindex-url = ${config.pythonIndexUrl}\nno-input = true\n\n[install]\nno-index = false\n`, { flag: 'wx', mode: 0o600 })
    mkdirSync(join(bundle, 'launcher'), { recursive: true })
    for (const name of ['launch.mjs', 'launch.sh', 'launch.ps1', 'dsh.mjs', 'extract.py', 'README_ZH.md', 'README_EN.md']) copyFileSync(join(root, 'scripts', 'offline', name), join(bundle, 'launcher', name))
    writeFileSync(join(bundle, 'launcher', 'dsh'), '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/../tools/node/bin/node" "$DIR/dsh.mjs" "$@"\n', { mode: 0o755, flag: 'wx' })
    writeFileSync(join(bundle, 'launcher', 'dsh.cmd'), '@echo off\r\n"%~dp0..\\tools\\node\\node.exe" "%~dp0dsh.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n', { flag: 'wx' })
    writeFileSync(join(bundle, 'launcher', 'dsh-tui.sh'), '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/launch.sh" "$@"\n', { mode: 0o755, flag: 'wx' })
    writeFileSync(join(bundle, 'launcher', 'dsh-tui.ps1'), "$ErrorActionPreference = 'Stop'\n$launcher = Join-Path $PSScriptRoot 'launch.mjs'\n$node = Join-Path $PSScriptRoot '..\\tools\\node\\node.exe'\n& $node $launcher @args\nexit $LASTEXITCODE\n", { flag: 'wx' })
    writeFileSync(join(bundle, 'LICENSE'), readFileSync(join(root, 'LICENSE')), { flag: 'wx' })
    json(join(bundle, 'platform-manifest.json'), {
      schemaVersion: 1,
      distributionId: config.distributionId,
      productVersion: version,
      sourceCommit,
      platform,
      toolchainId,
      platformBaseline: tools.platformBaseline,
      toolchainSources: tools.sourceManifest.sourceArchives,
      toolLicenses: tools.sourceManifest.licenses,
      versions: { ...versions, node: tools.nodeVersion, git: tools.gitVersion, python: tools.pythonVersion },
      toolsSourceSha256: createHash('sha256').update(JSON.stringify(tools.files)).digest('hex'),
      clientArchive: basename(updateArchive),
      clientArchiveSizeBytes: updateStat.size,
      clientArchiveSha256: manifest.platforms[platform].sha256,
      updateManifestSchema: 'offline/update-manifest.schema.json',
      licenseDirectory: 'tools/LICENSES and app/releases/<version>/LICENSES/npm/',
    })
    copyFileSync(join(root, 'offline', 'update-manifest.schema.json'), join(bundle, 'update-manifest.schema.json'))
    copyFileSync(join(root, 'offline', 'toolchain-manifest.schema.json'), join(bundle, 'toolchain-manifest.schema.json'))
    copyFileSync(join(root, 'offline', 'bundle-config.schema.json'), join(bundle, 'bundle-config.schema.json'))
    copyFileSync(join(root, 'offline', 'update-manifest.example.json'), join(bundle, 'update-manifest.example.json'))
    copyFileSync(join(root, 'offline', 'toolchain-manifest.example.json'), join(bundle, 'toolchain-manifest.example.json'))
    writeFileSync(join(bundle, 'README_ZH.md'), readFileSync(join(root, 'scripts', 'offline', 'README_ZH.md')), { flag: 'wx' })
    copyFileSync(join(root, 'scripts', 'offline', 'README_EN.md'), join(bundle, 'README.md'))
    const fullArchive = join(outputStaging, `dsh-tui-${config.distributionId}-${version}-${platform}-initial.${platform === 'win10-x64' ? 'zip' : 'tar.gz'}`)
    archive(platform === 'win10-x64' ? 'zip' : 'tar.gz', bundle, fullArchive, hostPython)
  }
  json(join(outputStaging, 'platform-manifest.json'), {
    schemaVersion: 1,
    distributionId: config.distributionId,
    version,
    sourceCommit,
    platform: targetPlatform,
    toolchainId: runtimes.get(targetPlatform).toolchainId,
    initialArchive: `dsh-tui-${config.distributionId}-${version}-${targetPlatform}-initial.${targetPlatform === 'win10-x64' ? 'zip' : 'tar.gz'}`,
    updateArchive: basename(new URL(manifest.platforms[targetPlatform].url, 'https://offline.invalid/').pathname),
  })
  validateOfflineManifest(manifest, { manifestUrl: config.manifestUrl, maxUpdateBytes: config.maxUpdateBytes })
  json(join(outputStaging, 'manifest.json'), manifest)
  const checksums = readdirSync(outputStaging).filter(name => name !== 'SHA256SUMS').sort().map(name => `${hashFile(join(outputStaging, name))}  ${name}`).join('\n')
  writeFileSync(join(outputStaging, 'SHA256SUMS'), `${checksums}\n`, { flag: 'wx' })
  renameSync(outputStaging, output)
  process.stdout.write(`Offline bundles written to ${output}\n`)
} finally {
  // Scratch contains only files created by this invocation. Keep output archives.
  rmSync(scratch, { recursive: true, force: true })
  rmSync(outputStaging, { recursive: true, force: true })
}
