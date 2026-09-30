#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { watchReleaseStartup } from './startup-watchdog.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = existsSync(join(here, 'config', 'offline.json')) ? resolve(here, '..') : resolve(here, '../..')
const message = text => process.stderr.write(`dsh-tui offline: ${text}\n`)
const fail = text => { message(text); process.exit(1) }
let config
try { config = JSON.parse(readFileSync(join(root, 'config', 'offline.json'), 'utf8')) }
catch { fail('bundle configuration is unreadable') }
const validHttps = value => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}
const platform = process.platform === 'win32' && process.arch === 'x64'
  ? 'win10-x64'
  : process.platform === 'linux' && process.arch === 'x64'
    ? 'kylin-v10-x64'
    : process.platform === 'linux' && process.arch === 'arm64'
      ? 'kylin-v10-arm64'
      : undefined
if (platform === undefined) fail('this OS/architecture is not supported by the offline bundle')
if (platform === 'win10-x64') {
  const build = Number(release().split('.')[2])
  if (!Number.isInteger(build) || build < 10240 || build >= 22000) fail('this bundle requires Windows 10 x64')
}
if (!process.stdin.isTTY || !process.stdout.isTTY) fail(platform.startsWith('kylin-') ? 'interactive SSH terminal required; connect with ssh -t' : 'interactive PowerShell terminal required')
if (platform.startsWith('kylin-')) {
  let release = ''
  try { release = readFileSync('/etc/os-release', 'utf8') } catch { fail('cannot verify the Kylin V10 platform baseline') }
  if (!/^ID=(?:"?kylin"?|"?kylin-server"?)$/imu.test(release) || !/^VERSION_ID=.*(?:V?10|10\.)/imu.test(release)) fail('this Linux distribution is outside the declared Kylin V10 support baseline')
}
if (config.schemaVersion !== 1 || !['superbpm', 'hxfl'].includes(config.distributionId) || config.platform !== platform || typeof config.toolchainId !== 'string' || !config.toolchainId.startsWith(`${config.distributionId}-`)
  || !validHttps(config.modelApiBaseUrl) || !validHttps(config.manifestUrl) || !validHttps(config.npmRegistry) || !validHttps(config.pythonIndexUrl)
  || !Number.isSafeInteger(config.maxUpdateBytes) || config.maxUpdateBytes < 1 || config.maxUpdateBytes > 8 * 1024 ** 3) fail('bundle configuration is invalid or does not match this platform')

const dataRoot = resolve(process.env.DSH_TUI_OFFLINE_HOME ?? (
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh-tui-offline', config.distributionId)
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'dsh-tui-offline', config.distributionId)
))
if (process.env.DSH_TUI_OFFLINE_HOME !== undefined && !isAbsolute(process.env.DSH_TUI_OFFLINE_HOME)) fail('DSH_TUI_OFFLINE_HOME must be an absolute path')
const dataRelative = relative(root, dataRoot)
if (dataRelative === '' || (!dataRelative.startsWith('..') && !isAbsolute(dataRelative))) fail('user data must be outside the program directory')
const cacheRoot = join(dataRoot, 'cache')
const tuiData = join(dataRoot, 'tui')
const dshHome = join(dataRoot, 'dsh')
const gitConfig = join(dataRoot, 'config', 'gitconfig')
const nodeDir = join(root, 'tools', 'node')
const gitDir = join(root, 'tools', 'git')
const pythonDir = join(root, 'tools', 'python')
for (const path of [nodeDir, gitDir, pythonDir, join(root, 'config', 'npmrc'), join(root, 'config', process.platform === 'win32' ? 'pip.ini' : 'pip.conf')]) {
  if (!existsSync(path)) fail('bundle is missing a required private tool or repository configuration')
}
const nodeBin = process.platform === 'win32' ? join(nodeDir, 'node.exe') : join(nodeDir, 'bin', 'node')
const wrapper = join(root, 'app', 'releases')
const activeFile = join(root, 'app', 'active.json')
if (!existsSync(activeFile)) fail('bundle is missing its active release pointer')
const active = JSON.parse(readFileSync(activeFile, 'utf8'))
if (typeof active.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(active.version)) fail('active release pointer is invalid')
const releaseDir = join(wrapper, active.version)
if (!releaseDir.startsWith(`${wrapper}/`) && !releaseDir.startsWith(`${wrapper}\\`)) fail('active release path is invalid')
const releaseManifest = JSON.parse(readFileSync(join(releaseDir, 'offline-release.json'), 'utf8'))
if (releaseManifest.version !== active.version || releaseManifest.distributionId !== config.distributionId || releaseManifest.toolchainId !== config.toolchainId || !releaseManifest.files || typeof releaseManifest.entry !== 'string') fail('active release is incompatible with the bundled tools')
for (const [relative, expected] of Object.entries(releaseManifest.files)) {
  if (relative.startsWith('/') || relative.includes('..') || relative.includes('\\')) fail('release manifest contains an unsafe path')
  const file = join(releaseDir, relative)
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (digest !== expected) fail(`release integrity check failed: ${relative}`)
}

mkdirSync(tuiData, { recursive: true })
mkdirSync(dshHome, { recursive: true })
mkdirSync(cacheRoot, { recursive: true })
mkdirSync(dirname(gitConfig), { recursive: true })
if (!existsSync(gitConfig)) writeFileSync(gitConfig, '', { flag: 'wx', mode: 0o600 })
const profile = join(dshHome, 'profiles', 'dsh-tui')
mkdirSync(profile, { recursive: true })
const profilePackage = join(profile, 'package.json')
if (!existsSync(profilePackage)) writeFileSync(profilePackage, `${JSON.stringify({ name: 'dsh-tui-offline-profile', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
const patch = join(profile, 'cordis.patch.yml')
if (!existsSync(patch)) writeFileSync(patch, readFileSync(join(releaseDir, 'cordis.patch.yml')), { flag: 'wx', mode: 0o600 })
const modulesPath = join(profile, 'node_modules')
const moduleTarget = join(releaseDir, 'node_modules')
const temporaryLink = join(profile, `.node_modules-${process.pid}`)
let profileModulesExist = false
try { lstatSync(modulesPath); profileModulesExist = true }
catch (error) { if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error }
if (profileModulesExist) {
  if (!lstatSync(modulesPath).isSymbolicLink()) fail('profile node_modules is a real directory; refusing to replace user data')
  try {
    const currentTarget = resolve(dirname(modulesPath), readlinkSync(modulesPath))
    if (currentTarget === resolve(moduleTarget)) {
      // Keep an already-correct link without touching the profile.
    } else {
      throw new Error('profile node_modules points at a different release')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'profile node_modules points at a different release') {
      const staleLink = join(profile, `.node_modules-old-${process.pid}`)
      renameSync(modulesPath, staleLink)
      try {
        symlinkSync(moduleTarget, temporaryLink, process.platform === 'win32' ? 'junction' : 'dir')
        renameSync(temporaryLink, modulesPath)
        if (process.platform === 'win32') rmdirSync(staleLink)
        else unlinkSync(staleLink)
      } catch (linkError) {
        try {
          if (profileModulesExist && lstatSync(modulesPath).isSymbolicLink()) {
            if (process.platform === 'win32') rmdirSync(modulesPath)
            else unlinkSync(modulesPath)
          }
        } catch {}
        try { renameSync(staleLink, modulesPath) } catch {}
        throw linkError
      }
    } else throw error
  }
} else {
  symlinkSync(moduleTarget, modulesPath, process.platform === 'win32' ? 'junction' : 'dir')
}

const toolBins = process.platform === 'win32'
  ? [join(root, 'launcher'), nodeDir, join(gitDir, 'cmd'), join(gitDir, 'bin'), join(gitDir, 'usr', 'bin'), pythonDir, join(pythonDir, 'Scripts')]
  : [join(root, 'launcher'), join(nodeDir, 'bin'), join(gitDir, 'bin'), join(pythonDir, 'bin')]
const env = {
  ...process.env,
  DSH_TUI_OFFLINE: '1',
  DSH_TUI_OFFLINE_DISTRIBUTION_ID: config.distributionId,
  DSH_TUI_OFFLINE_ROOT: root,
  DSH_TUI_OFFLINE_HOME: dataRoot,
  DSH_TUI_OFFLINE_PLATFORM: platform,
  DSH_TUI_OFFLINE_TOOLCHAIN_ID: config.toolchainId,
  DSH_TUI_OFFLINE_MANIFEST_URL: config.manifestUrl,
  DSH_TUI_OFFLINE_MODEL_API_BASE_URL: config.modelApiBaseUrl,
  DSH_TUI_OFFLINE_MAX_UPDATE_BYTES: String(config.maxUpdateBytes),
  DSH_TUI_OFFLINE_LAUNCHER: fileURLToPath(import.meta.url),
  DSH_TUI_DATA_DIR: tuiData,
  DSH_TUI_STANDALONE_CACHE: cacheRoot,
  DSH_HOME: dshHome,
  DEEPSEEK_BASE_URL: config.modelApiBaseUrl,
  XDG_CACHE_HOME: cacheRoot,
  NPM_CONFIG_USERCONFIG: join(root, 'config', 'npmrc'),
  NPM_CONFIG_GLOBALCONFIG: join(root, 'config', 'npmrc'),
  NPM_CONFIG_REGISTRY: config.npmRegistry,
  NPM_CONFIG_CACHE: join(cacheRoot, 'npm'),
  npm_config_registry: config.npmRegistry,
  npm_config_userconfig: join(root, 'config', 'npmrc'),
  npm_config_globalconfig: join(root, 'config', 'npmrc'),
  npm_config_cache: join(cacheRoot, 'npm'),
  PIP_CONFIG_FILE: join(root, 'config', process.platform === 'win32' ? 'pip.ini' : 'pip.conf'),
  PIP_INDEX_URL: config.pythonIndexUrl,
  PIP_CACHE_DIR: join(cacheRoot, 'pip'),
  GIT_CONFIG_GLOBAL: gitConfig,
  PYTHONHOME: pythonDir,
  PATH: [...toolBins, process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':'),
}
for (const key of ['PIP_EXTRA_INDEX_URL', 'PIP_FIND_LINKS', 'PIP_TRUSTED_HOST']) delete env[key]
if (process.platform === 'win32') { env.MSYSTEM = 'MINGW64'; env.CHERE_INVOKING = '1' }
const appEntry = join(releaseDir, releaseManifest.entry)
if (!existsSync(appEntry) || !existsSync(nodeBin)) fail('offline runtime entry is missing')
const child = spawn(nodeBin, [appEntry, ...process.argv.slice(2)], { cwd: process.cwd(), env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] })
watchReleaseStartup({
  child,
  active,
  activeFile,
  releasesDirectory: wrapper,
  message,
  onExit: (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
  },
})
