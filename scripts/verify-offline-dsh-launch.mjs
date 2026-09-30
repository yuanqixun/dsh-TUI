#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

if (process.platform === 'win32') {
  process.stdout.write('offline direct DSH launcher fixture skipped on Windows host (requires a POSIX executable fixture)\n')
  process.exit(0)
}

const root = mkdtempSync(join(tmpdir(), 'offline dsh fixture '))
const bundle = join(root, '程序 目录')
const data = join(root, '用户 数据')
const capture = join(root, 'capture')
const launcher = join(bundle, 'launcher', 'dsh.mjs')
const node = join(bundle, 'tools', 'node', 'bin', 'node')
const cwd = join(root, '工作 目录')
try {
  mkdirSync(join(bundle, 'config'), { recursive: true })
  mkdirSync(join(bundle, 'launcher'), { recursive: true })
  mkdirSync(join(bundle, 'app', 'releases', '1.2.3', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  mkdirSync(join(bundle, 'tools', 'node', 'bin'), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(launcher, readFileSync(new URL('./offline/dsh.mjs', import.meta.url)))
  writeFileSync(join(bundle, 'config', 'offline.json'), JSON.stringify({
    schemaVersion: 1,
    distributionId: 'superbpm',
    platform: 'kylin-v10-x64',
    toolchainId: 'superbpm-tools-1',
    modelApiBaseUrl: 'https://model.internal/v1',
    manifestUrl: 'https://updates.internal/manifest.json',
    maxUpdateBytes: 1234,
    npmRegistry: 'https://npm.internal/',
    pythonIndexUrl: 'https://pypi.internal/simple/',
  }))
  writeFileSync(join(bundle, 'app', 'active.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(bundle, 'app', 'releases', '1.2.3', 'offline-release.json'), JSON.stringify({ version: '1.2.3', distributionId: 'superbpm', toolchainId: 'superbpm-tools-1', entry: 'lib/index.js' }))
  writeFileSync(join(bundle, 'app', 'releases', '1.2.3', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '')
  writeFileSync(join(bundle, 'config', 'npmrc'), 'registry=https://npm.internal/\n')
  writeFileSync(join(bundle, 'config', 'pip.conf'), '[global]\nindex-url = https://pypi.internal/simple/\n')
  writeFileSync(node, '#!/bin/sh\nenv > "$OFFLINE_CAPTURE_ENV"\nprintf \'%s\\0\' "$@" > "$OFFLINE_CAPTURE_ARGS"\npwd > "$OFFLINE_CAPTURE_CWD"\nexit 37\n')
  chmodSync(node, 0o755)

  assert.throws(() => execFileSync(process.execPath, [launcher, '中文参数', 'space arg'], {
    cwd,
    env: {
      ...process.env,
      DSH_TUI_OFFLINE_HOME: data,
      NPM_CONFIG_REGISTRY: 'https://wrong.invalid/',
      PIP_EXTRA_INDEX_URL: 'https://wrong.invalid/simple/',
      OFFLINE_CAPTURE_ENV: capture,
      OFFLINE_CAPTURE_ARGS: `${capture}.args`,
      OFFLINE_CAPTURE_CWD: `${capture}.cwd`,
    },
    stdio: 'pipe',
  }), error => error?.status === 37)

  const environment = readFileSync(capture, 'utf8')
  assert.match(environment, new RegExp(`DSH_HOME=${data}/dsh`))
  assert.match(environment, new RegExp(`DSH_TUI_DATA_DIR=${data}/tui`))
  assert.match(environment, /DEEPSEEK_BASE_URL=https:\/\/model\.internal\/v1/)
  assert.match(environment, /NPM_CONFIG_REGISTRY=https:\/\/npm\.internal\//)
  assert.match(environment, /PIP_INDEX_URL=https:\/\/pypi\.internal\/simple\//)
  assert.doesNotMatch(environment, /PIP_EXTRA_INDEX_URL=/)
  assert.match(environment, new RegExp(`GIT_CONFIG_GLOBAL=${data}/config/gitconfig`))
  assert.deepEqual(readFileSync(`${capture}.args`).toString().split('\0'), [realpathSync(join(bundle, 'app', 'releases', '1.2.3', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')), '中文参数', 'space arg', ''])
  assert.equal(readFileSync(`${capture}.cwd`, 'utf8').trim(), realpathSync(cwd))
  assert.throws(() => execFileSync(process.execPath, [launcher], { env: { ...process.env, DSH_TUI_OFFLINE_HOME: 'relative/path' }, stdio: 'pipe' }), error => error?.status === 1 && /must be an absolute path/u.test(error.stderr.toString()))
  assert.throws(() => execFileSync(process.execPath, [launcher], { env: { ...process.env, DSH_TUI_OFFLINE_HOME: join(realpathSync(bundle), 'user-data') }, stdio: 'pipe' }), error => error?.status === 1 && /outside the program directory/u.test(error.stderr.toString()))
  writeFileSync(join(bundle, 'app', 'active.json'), JSON.stringify({ version: '../../outside' }))
  assert.throws(() => execFileSync(process.execPath, [launcher], { env: process.env, stdio: 'pipe' }), error => error?.status === 1 && /active release pointer is invalid/u.test(error.stderr.toString()))
  writeFileSync(join(bundle, 'app', 'active.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(bundle, 'app', 'releases', '1.2.3', 'offline-release.json'), JSON.stringify({ version: '1.2.3', distributionId: 'hxfl', toolchainId: 'hxfl-tools-1', entry: 'lib/index.js' }))
  assert.throws(() => execFileSync(process.execPath, [launcher], { env: process.env, stdio: 'pipe' }), error => error?.status === 1 && /active release is incompatible/u.test(error.stderr.toString()))
  process.stdout.write('offline direct DSH launcher verified (private environment, internal repositories, user data, Unicode/spaced args, cwd and exit code)\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
