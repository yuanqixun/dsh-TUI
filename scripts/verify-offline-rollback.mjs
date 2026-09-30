#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restorePreviousRelease } from './offline/rollback.mjs'

const root = mkdtempSync(join(tmpdir(), 'verify-offline-rollback-'))
const releases = join(root, 'app', 'releases')
const activeFile = join(root, 'app', 'active.json')
const toolMarker = join(root, 'tools', 'node-version.txt')
const userData = join(root, 'user-data', 'settings.json')
try {
  mkdirSync(join(releases, '0.11.1'), { recursive: true })
  mkdirSync(join(releases, '0.11.2'), { recursive: true })
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(root, 'user-data'), { recursive: true })
  writeFileSync(join(releases, '0.11.1', 'offline-release.json'), '{}\n')
  writeFileSync(join(releases, '0.11.2', 'offline-release.json'), '{}\n')
  writeFileSync(activeFile, `${JSON.stringify({ version: '0.11.2', previousVersion: '0.11.1' }, null, 2)}\n`)
  writeFileSync(toolMarker, 'node-toolchain-preserved\n')
  writeFileSync(userData, 'settings-preserved\n')

  const restored = restorePreviousRelease({
    active: JSON.parse(readFileSync(activeFile, 'utf8')),
    activeFile,
    releasesDirectory: releases,
    processId: 'successful-rollback',
  })
  assert.deepEqual(restored, { restored: true, version: '0.11.1' })
  assert.deepEqual(JSON.parse(readFileSync(activeFile, 'utf8')), { version: '0.11.1' })
  assert.equal(readFileSync(toolMarker, 'utf8'), 'node-toolchain-preserved\n')
  assert.equal(readFileSync(userData, 'utf8'), 'settings-preserved\n')

  const withoutPrevious = { version: '0.11.2', previousVersion: '0.10.9' }
  writeFileSync(activeFile, `${JSON.stringify(withoutPrevious, null, 2)}\n`)
  const kept = restorePreviousRelease({
    active: withoutPrevious,
    activeFile,
    releasesDirectory: releases,
    processId: 'missing-rollback',
  })
  assert.deepEqual(kept, { restored: false, version: '0.11.2' })
  assert.deepEqual(JSON.parse(readFileSync(activeFile, 'utf8')), withoutPrevious)

  const unsafePrevious = { version: '0.11.2', previousVersion: '../outside' }
  writeFileSync(activeFile, `${JSON.stringify(unsafePrevious, null, 2)}\n`)
  const refused = restorePreviousRelease({
    active: unsafePrevious,
    activeFile,
    releasesDirectory: releases,
    processId: 'unsafe-rollback',
  })
  assert.deepEqual(refused, { restored: false, version: '0.11.2' })
  assert.deepEqual(JSON.parse(readFileSync(activeFile, 'utf8')), unsafePrevious)

  process.stdout.write('offline rollback verified (previous release pointer restored atomically; missing and unsafe targets are retained; tools and data untouched)\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
