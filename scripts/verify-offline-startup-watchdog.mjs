#!/usr/bin/env node
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchReleaseStartup } from './offline/startup-watchdog.mjs'

const root = mkdtempSync(join(tmpdir(), 'verify-offline-watchdog-'))
const releases = join(root, 'app', 'releases')
const activeFile = join(root, 'app', 'active.json')
const messages = []
let timerCallback
let timerCleared = false
function fixture() {
  mkdirSync(join(releases, '0.11.1'), { recursive: true })
  mkdirSync(join(releases, '0.11.2'), { recursive: true })
  writeFileSync(join(releases, '0.11.1', 'offline-release.json'), '{}\n')
  writeFileSync(join(releases, '0.11.2', 'offline-release.json'), '{}\n')
  writeFileSync(activeFile, `${JSON.stringify({ version: '0.11.2', previousVersion: '0.11.1' })}\n`)
}
function watch(child, onExit = () => {}) {
  return watchReleaseStartup({
    child,
    active: JSON.parse(readFileSync(activeFile, 'utf8')),
    activeFile,
    releasesDirectory: releases,
    timeoutMs: 120_000,
    message: value => messages.push(value),
    setTimer: callback => { timerCallback = callback; return 'timer' },
    clearTimer: timer => { assert.equal(timer, 'timer'); timerCleared = true },
    onExit,
  })
}
function activeVersion() {
  return JSON.parse(readFileSync(activeFile, 'utf8')).version
}

try {
  fixture()
  const healthyChild = new EventEmitter()
  healthyChild.kill = () => assert.fail('ready child must not be killed')
  watch(healthyChild)
  healthyChild.emit('message', { type: 'dsh-tui-offline-ready' })
  assert.equal(timerCleared, true)
  assert.equal(activeVersion(), '0.11.2')
  timerCallback()
  assert.equal(activeVersion(), '0.11.2', 'late timeout must not roll back a ready release')

  fixture()
  messages.length = 0
  timerCleared = false
  const failedChild = new EventEmitter()
  let killCount = 0
  failedChild.kill = () => { killCount += 1 }
  let exitObserved
  watch(failedChild, (code, signal) => { exitObserved = { code, signal } })
  failedChild.emit('exit', 1, null)
  assert.equal(activeVersion(), '0.11.1')
  assert.equal(killCount, 1)
  assert.deepEqual(exitObserved, { code: 1, signal: null })
  assert.match(messages[0], /restored 0\.11\.1/u)

  fixture()
  messages.length = 0
  timerCleared = false
  const hungChild = new EventEmitter()
  let timeoutKillCount = 0
  hungChild.kill = () => { timeoutKillCount += 1 }
  watch(hungChild)
  timerCallback()
  assert.equal(activeVersion(), '0.11.1')
  assert.equal(timeoutKillCount, 1)
  assert.equal(timerCleared, true)
  assert.match(messages[0], /did not finish starting; restored 0\.11\.1/u)

  fixture()
  messages.length = 0
  timerCleared = false
  const launchErrorChild = new EventEmitter()
  let launchErrorKillCount = 0
  launchErrorChild.kill = () => { launchErrorKillCount += 1 }
  watch(launchErrorChild)
  launchErrorChild.emit('error', new Error('spawn failed'))
  assert.equal(activeVersion(), '0.11.1')
  assert.equal(launchErrorKillCount, 1)
  assert.equal(timerCleared, true)
  assert.match(messages[0], /could not launch; restored 0\.11.1/u)

  process.stdout.write('offline startup watchdog verified (ready clears timeout; failed, errored and timed-out startup restore previous release and terminate child; exit propagates)\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
