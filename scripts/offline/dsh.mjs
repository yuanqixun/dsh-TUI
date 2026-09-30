#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = existsSync(join(here, '..', 'config', 'offline.json')) ? resolve(here, '..') : resolve(here, '../..')
const active = JSON.parse(readFileSync(join(root, 'app', 'active.json'), 'utf8'))
if (typeof active.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(active.version)) throw new Error('dsh offline launcher: active release pointer is invalid')
const release = join(root, 'app', 'releases', active.version)
const releases = join(root, 'app', 'releases')
if (!release.startsWith(`${releases}/`) && !release.startsWith(`${releases}\\`)) throw new Error('dsh offline launcher: active release path is invalid')
const node = process.platform === 'win32' ? join(root, 'tools', 'node', 'node.exe') : join(root, 'tools', 'node', 'bin', 'node')
const cli = join(release, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const config = JSON.parse(readFileSync(join(root, 'config', 'offline.json'), 'utf8'))
if (config.schemaVersion !== 1 || !['superbpm', 'hxfl'].includes(config.distributionId)) throw new Error('dsh offline launcher: bundle configuration is invalid')
if (typeof config.toolchainId !== 'string' || !config.toolchainId.startsWith(`${config.distributionId}-`)) throw new Error('dsh offline launcher: bundle toolchain is invalid')
const releaseManifest = JSON.parse(readFileSync(join(release, 'offline-release.json'), 'utf8'))
if (releaseManifest.version !== active.version || releaseManifest.distributionId !== config.distributionId || releaseManifest.toolchainId !== config.toolchainId || typeof releaseManifest.entry !== 'string') throw new Error('dsh offline launcher: active release is incompatible with the bundled tools')
if (!existsSync(node) || !existsSync(cli) || !existsSync(join(root, 'config', 'npmrc')) || !existsSync(join(root, 'config', process.platform === 'win32' ? 'pip.ini' : 'pip.conf'))) throw new Error('dsh offline launcher: bundle is missing a required runtime or repository configuration')
if (process.env.DSH_TUI_OFFLINE_HOME !== undefined && !isAbsolute(process.env.DSH_TUI_OFFLINE_HOME)) throw new Error('dsh offline launcher: DSH_TUI_OFFLINE_HOME must be an absolute path')
const dataRoot = resolve(process.env.DSH_TUI_OFFLINE_HOME ?? (
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh-tui-offline', config.distributionId)
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'dsh-tui-offline', config.distributionId)
))
const dataRelative = relative(root, dataRoot)
if (dataRelative === '' || (!dataRelative.startsWith('..') && !isAbsolute(dataRelative))) throw new Error('dsh offline launcher: user data must be outside the program directory')
const cacheRoot = join(dataRoot, 'cache')
const dshHome = join(dataRoot, 'dsh')
const gitConfig = join(dataRoot, 'config', 'gitconfig')
mkdirSync(dshHome, { recursive: true })
mkdirSync(cacheRoot, { recursive: true })
mkdirSync(dirname(gitConfig), { recursive: true })
if (!existsSync(gitConfig)) writeFileSync(gitConfig, '', { flag: 'wx', mode: 0o600 })
const nodeDir = join(root, 'tools', 'node')
const gitDir = join(root, 'tools', 'git')
const pythonDir = join(root, 'tools', 'python')
const npmrc = join(root, 'config', 'npmrc')
const pipConfig = join(root, 'config', process.platform === 'win32' ? 'pip.ini' : 'pip.conf')
const toolBins = process.platform === 'win32'
  ? [join(root, 'launcher'), nodeDir, join(gitDir, 'cmd'), join(gitDir, 'bin'), join(gitDir, 'usr', 'bin'), pythonDir, join(pythonDir, 'Scripts')]
  : [join(root, 'launcher'), join(nodeDir, 'bin'), join(gitDir, 'bin'), join(pythonDir, 'bin')]
const env = {
  ...process.env,
  DSH_TUI_OFFLINE: '1',
  DSH_TUI_OFFLINE_DISTRIBUTION_ID: config.distributionId,
  DSH_TUI_OFFLINE_ROOT: root,
  DSH_TUI_OFFLINE_HOME: dataRoot,
  DSH_TUI_OFFLINE_PLATFORM: config.platform,
  DSH_TUI_OFFLINE_TOOLCHAIN_ID: config.toolchainId,
  DSH_TUI_OFFLINE_MANIFEST_URL: config.manifestUrl,
  DSH_TUI_OFFLINE_MODEL_API_BASE_URL: config.modelApiBaseUrl,
  DSH_TUI_OFFLINE_MAX_UPDATE_BYTES: String(config.maxUpdateBytes),
  DSH_TUI_OFFLINE_LAUNCHER: fileURLToPath(import.meta.url),
  DSH_TUI_DATA_DIR: join(dataRoot, 'tui'),
  DSH_TUI_STANDALONE_CACHE: cacheRoot,
  DSH_HOME: dshHome,
  DEEPSEEK_BASE_URL: config.modelApiBaseUrl,
  XDG_CACHE_HOME: cacheRoot,
  NPM_CONFIG_USERCONFIG: npmrc,
  NPM_CONFIG_GLOBALCONFIG: npmrc,
  NPM_CONFIG_REGISTRY: config.npmRegistry,
  NPM_CONFIG_CACHE: join(cacheRoot, 'npm'),
  npm_config_registry: config.npmRegistry,
  npm_config_userconfig: npmrc,
  npm_config_globalconfig: npmrc,
  npm_config_cache: join(cacheRoot, 'npm'),
  PIP_CONFIG_FILE: pipConfig,
  PIP_INDEX_URL: config.pythonIndexUrl,
  PIP_CACHE_DIR: join(cacheRoot, 'pip'),
  GIT_CONFIG_GLOBAL: gitConfig,
  PYTHONHOME: pythonDir,
  PATH: [...toolBins, process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':'),
}
for (const key of ['PIP_EXTRA_INDEX_URL', 'PIP_FIND_LINKS', 'PIP_TRUSTED_HOST']) delete env[key]
if (process.platform === 'win32') { env.MSYSTEM = 'MINGW64'; env.CHERE_INVOKING = '1' }
const child = spawn(node, [cli, ...process.argv.slice(2)], { cwd: process.cwd(), env, stdio: 'inherit' })
child.on('error', error => { process.stderr.write(`dsh offline launcher failed: ${error.message}\n`); process.exitCode = 127 })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
