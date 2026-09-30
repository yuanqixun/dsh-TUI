#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') {
  process.stdout.write('offline toolchain lock fixture skipped on Windows host (requires POSIX executable fixtures)\n')
  process.exit(0)
}

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'offline toolchain lock fixture '))
const source = join(root, 'toolchain')
const metadataPath = join(root, 'metadata.json')

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

try {
  for (const path of ['node/bin', 'git/bin', 'python/bin', 'LICENSES', 'sources']) mkdirSync(join(source, path), { recursive: true })
  for (const [name, version] of Object.entries({ node: 'v24.9.0', git: 'git version 2.51.0', python3: 'Python 3.13.7' })) {
    const path = name === 'node' ? join(source, 'node/bin/node') : name === 'git' ? join(source, 'git/bin/git') : join(source, 'python/bin/python3')
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`)
    chmodSync(path, 0o755)
  }
  for (const [name, content] of Object.entries({
    'node-MIT.txt': 'Node.js: MIT; bundled third-party notices are included.\n',
    'git-GPL.txt': 'Git: GPL-2.0-or-later.\n',
    'python-PSF.txt': 'Python: PSF-2.0; bundled third-party notices are included.\n',
  })) writeFileSync(join(source, 'LICENSES', name), content)
  const sourceArchives = {}
  for (const name of ['node', 'git', 'python']) {
    const file = `sources/${name}-fixture.tar.gz`
    const contents = Buffer.from(`locked ${name} source fixture\n`)
    writeFileSync(join(source, file), contents)
    sourceArchives[name] = { file, sha256: digest(contents) }
  }
  const metadata = {
    id: 'hxfl-kylin-v10-x64-tools-fixture',
    nodeVersion: 'v24.9.0',
    gitVersion: 'git version 2.51.0',
    pythonVersion: 'Python 3.13.7',
    platformBaseline: 'Kylin V10 x64 fixture baseline',
    licenses: {
      node: 'MIT; bundled third-party notices under LICENSES/',
      git: 'GPL-2.0-or-later',
      python: 'PSF-2.0; bundled third-party notices under LICENSES/',
    },
    sourceArchives,
  }
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  const lockScript = join(repository, 'scripts', 'offline', 'lock-toolchain.mjs')
  execFileSync(process.execPath, ['--import', 'tsx/esm', lockScript, 'kylin-v10-x64', source, metadataPath], { cwd: repository, stdio: 'pipe' })
  const locked = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  assert.deepEqual(locked.licenses, metadata.licenses)
  assert.equal(locked.schemaVersion, 1)
  assert.equal(locked.platform, 'kylin-v10-x64')
  assert.equal(Object.keys(locked.files).some(path => path.startsWith('LICENSES/')), true)

  const incompleteMetadataPath = join(root, 'metadata-incomplete.json')
  const { licenses: _licenses, ...incomplete } = metadata
  writeFileSync(incompleteMetadataPath, `${JSON.stringify(incomplete, null, 2)}\n`)
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx/esm', lockScript, 'kylin-v10-x64', source, incompleteMetadataPath], { cwd: repository, stdio: 'pipe' }), error => error?.status === 1 && /missing license declarations/u.test(error.stderr.toString()))
  process.stdout.write('offline toolchain lock verified (Node/Git/Python versions, explicit licenses, source archive hashes, and license file hashes)\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
