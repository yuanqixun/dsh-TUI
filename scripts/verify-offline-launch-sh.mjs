#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = mkdtempSync(join(tmpdir(), 'offline 启动器 fixture '))
const launcherDir = join(root, '程序 路径', 'launcher')
const toolsDir = join(root, '程序 路径', 'tools', 'node', 'bin')
const cwd = join(root, '工作 目录')
const argsFile = join(root, '捕获 参数.bin')
const cwdFile = join(root, '捕获 cwd.txt')
const exitCode = 37
try {
  mkdirSync(launcherDir, { recursive: true })
  mkdirSync(toolsDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const launcher = join(launcherDir, 'launch.sh')
  writeFileSync(launcher, readFileSync(new URL('./offline/launch.sh', import.meta.url)))
  writeFileSync(join(toolsDir, 'node'), `#!/bin/sh\nprintf '%s\\0' "$@" > "$OFFLINE_CAPTURE_ARGS"\npwd > "$OFFLINE_CAPTURE_CWD"\nexit "$OFFLINE_CAPTURE_EXIT"\n`)
  chmodSync(launcher, 0o755)
  chmodSync(join(toolsDir, 'node'), 0o755)

  const args = ['参数 with spaces', '中文参数']
  assert.throws(() => execFileSync('sh', [launcher, ...args], {
    cwd,
    env: { ...process.env, OFFLINE_CAPTURE_ARGS: argsFile, OFFLINE_CAPTURE_CWD: cwdFile, OFFLINE_CAPTURE_EXIT: String(exitCode) },
    stdio: 'pipe',
  }), error => error?.status === exitCode)
  assert.deepEqual(readFileSync(argsFile).toString().split('\0'), [join(launcherDir, 'launch.mjs'), ...args, ''])
  assert.equal(readFileSync(cwdFile, 'utf8').trim(), realpathSync(cwd))
  process.stdout.write('offline POSIX launcher verified (Unicode/spaces in install and working paths, argument preservation, cwd preservation, child exit code)\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
