#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'verify-offline-data-isolation-'))
const repository = fileURLToPath(new URL('..', import.meta.url))
const home = join(root, 'home')
const legacyData = join(home, '.dsh-tui')
const legacySentinel = join(legacyData, 'other-client.json')
const legacyDsh = join(home, '.dsh')
const legacyCredentialSentinel = join(legacyDsh, 'credentials.json')
const distributions = ['superbpm', 'hxfl']
const child = `
  import assert from 'node:assert/strict'
  import { readdirSync, readFileSync } from 'node:fs'
  import { DATA_DIR } from './src/utils/paths.ts'
  import { writeActivityFrames } from './src/activityPrefs.ts'
  import { writeModelPref } from './src/modelPrefs.ts'
  import { writeThemePref } from './src/themePrefs.ts'
  import { recordLaunch } from './src/usageStats.ts'
  import { writeSessionPins } from './src/sessionPins.ts'
  import { sessionsRoots } from './src/dsh-adapter/compat/sessionLog.ts'
  import { credentialRefDeclared } from './src/utils/credentials.ts'
  import { ensurePackagedPresets } from './src/dsh-adapter/packaged-presets.ts'
  assert.equal(DATA_DIR, process.env.DSH_TUI_DATA_DIR)
  assert.equal(writeActivityFrames('dots'), true)
  assert.equal(writeModelPref('provider', 'model'), true)
  assert.equal(writeThemePref('dark'), true)
  recordLaunch()
  assert.equal(writeSessionPins(['session-test']), true)
  assert.deepEqual(sessionsRoots(), [process.env.DSH_HOME + '/sessions', DATA_DIR + '/sessions'])
  assert.equal(credentialRefDeclared('DEEPSEEK_API_KEY'), true)
  assert.ok(ensurePackagedPresets({ dshHome: process.env.DSH_HOME }).length > 0)
  assert.deepEqual(readdirSync(DATA_DIR).sort(), [
    'model.json', 'session-pins.json', 'theme.json', 'usage.json', 'working-activity.json',
  ])
`

try {
  mkdirSync(legacyData, { recursive: true })
  mkdirSync(legacyDsh, { recursive: true })
  writeFileSync(legacySentinel, 'leave-other-client-state-unchanged\n')
  writeFileSync(legacyCredentialSentinel, 'leave-other-client-credentials-unchanged\n')
  const sourceRoot = join(repository, 'src')
  const dataDirModules = []
  function inventory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) inventory(path)
      else if (/\.tsx?$/u.test(entry.name) && entry.name !== 'paths.ts') {
        const contents = readFileSync(path, 'utf8')
        if (contents.includes('DATA_DIR')) dataDirModules.push(path)
        assert.doesNotMatch(contents, /join\(homeDir\(\),\s*['"]\.dsh-tui/u, `${path} must use the shared TUI data root`)
      }
    }
  }
  inventory(sourceRoot)
  assert.ok(dataDirModules.length >= 20, 'the state-path inventory should cover all TUI data consumers')
  const roots = []
  for (const distributionId of distributions) {
    const dataRoot = join(root, 'data', distributionId, 'tui')
    const dshHome = join(root, 'data', distributionId, 'dsh')
    mkdirSync(dataRoot, { recursive: true })
    mkdirSync(dshHome, { recursive: true })
    writeFileSync(join(dshHome, '.credentials.yaml'), 'refs:\n  DEEPSEEK_API_KEY: credential-ref\n')
    execFileSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', child], {
      cwd: repository,
      env: { ...process.env, HOME: home, DSH_HOME: dshHome, DSH_TUI_DATA_DIR: dataRoot },
      stdio: 'pipe',
    })
    roots.push(dataRoot, dshHome)
  }

  const superbpmSettings = readFileSync(join(roots[0], 'working-activity.json'), 'utf8')
  const hxflSettings = readFileSync(join(roots[2], 'working-activity.json'), 'utf8')
  assert.equal(superbpmSettings, hxflSettings)
  assert.equal(readFileSync(legacySentinel, 'utf8'), 'leave-other-client-state-unchanged\n')
  assert.equal(readFileSync(legacyCredentialSentinel, 'utf8'), 'leave-other-client-credentials-unchanged\n')
  assert.deepEqual(roots.slice(0, 4), [
    join(root, 'data', 'superbpm', 'tui'), join(root, 'data', 'superbpm', 'dsh'),
    join(root, 'data', 'hxfl', 'tui'), join(root, 'data', 'hxfl', 'dsh'),
  ])
  process.stdout.write(`offline data isolation verified (${dataDirModules.length} DATA_DIR consumers inventoried; TUI preferences, usage, pins, DSH sessions and other-client state stay within their configured roots for both profiles)\n`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
