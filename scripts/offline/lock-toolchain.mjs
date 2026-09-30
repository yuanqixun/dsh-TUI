#!/usr/bin/env node
/** Lock an acquired Node/Git/Python tool tree and record its source archive hashes. */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { OFFLINE_DISTRIBUTIONS, OFFLINE_PLATFORMS } from '../../src/offlineContracts.ts'

const [platform, sourceArg, metadataArg, ...extra] = process.argv.slice(2)
if (!OFFLINE_PLATFORMS.includes(platform) || !sourceArg || !metadataArg || extra.length) {
  console.error('Usage: node --import tsx/esm scripts/offline/lock-toolchain.mjs <platform> <tool-root> <metadata.json>')
  process.exit(2)
}
const source = resolve(sourceArg)
const metadata = JSON.parse(readFileSync(resolve(metadataArg), 'utf8'))
if (!OFFLINE_DISTRIBUTIONS.some(distribution => typeof metadata.id === 'string' && metadata.id.startsWith(`${distribution}-`))) throw new Error('toolchain id must begin with superbpm- or hxfl- so update channels stay isolated')
const digest = path => {
  const descriptor = openSync(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const size = fstatSync(descriptor).size
    for (let position = 0; position < size;) {
      const length = readSync(descriptor, buffer, 0, Math.min(buffer.length, size - position), position)
      if (length === 0) throw new Error('Unexpected end of file while hashing toolchain input')
      hash.update(buffer.subarray(0, length))
      position += length
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}
const archives = metadata.sourceArchives
if (!archives || typeof archives !== 'object' || Array.isArray(archives) || Object.keys(archives).sort().join(',') !== 'git,node,python') throw new Error('metadata needs Node, Git and Python source archive hashes')
if (metadata.schemaVersion !== undefined || metadata.platform !== undefined || metadata.files !== undefined) throw new Error('metadata must not override schemaVersion, platform, or files')
if (Object.keys(metadata).sort().join(',') !== 'gitVersion,id,licenses,nodeVersion,platformBaseline,pythonVersion,sourceArchives') throw new Error('metadata contains unknown fields or is missing license declarations')
for (const key of ['gitVersion', 'id', 'nodeVersion', 'platformBaseline', 'pythonVersion']) {
  if (typeof metadata[key] !== 'string' || !metadata[key] || metadata[key].length > 4096 || /[\u0000-\u001f\u007f]/u.test(metadata[key]) || /待|TODO/iu.test(metadata[key])) throw new Error(`metadata is incomplete: ${key}`)
}
const toolNames = ['git', 'node', 'python']
if (!metadata.licenses || typeof metadata.licenses !== 'object' || Array.isArray(metadata.licenses) || Object.keys(metadata.licenses).sort().join(',') !== toolNames.join(',')) throw new Error('metadata.licenses must declare Node, Git, and Python')
for (const name of toolNames) {
  const license = metadata.licenses[name]
  if (typeof license !== 'string' || !license || license.length > 4096 || /[\u0000-\u001f\u007f]/u.test(license) || /待|TODO/iu.test(license)) throw new Error(`metadata.licenses.${name} is incomplete`)
}
for (const [name, archive] of Object.entries(archives)) {
  if (!/^(?:node|git|python)$/u.test(name) || !archive || typeof archive.file !== 'string' || !/^[0-9a-f]{64}$/iu.test(archive.sha256)) throw new Error('sourceArchives entry is invalid')
  if (isAbsolute(archive.file) || archive.file.split(/[\\/]/u).includes('..')) throw new Error('source archive path must be relative to the tool root')
  const path = resolve(source, archive.file)
  const archiveRelative = relative(source, path)
  if (archiveRelative.startsWith('..') || isAbsolute(archiveRelative) || !existsSync(path) || lstatSync(path).isSymbolicLink() || digest(path) !== archive.sha256) throw new Error(`source archive hash does not match: ${name}`)
}
const files = {}
let count = 0
let bytes = 0
function walk(directory, virtual = '', ancestors = []) {
  const realDirectory = realpathSync(directory)
  if (ancestors.includes(realDirectory)) throw new Error('tool tree contains a directory-link cycle')
  const nextAncestors = [...ancestors, realDirectory]
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === source && ['manifest.json', 'sources'].includes(entry.name)) continue
    if (entry.name === '.bin') continue
    if (entry.name === '.git' || /^\.(?:env|npmrc|pypirc|netrc)/iu.test(entry.name) || /\.(?:pem|key|p12|pfx|sqlite|log)$/iu.test(entry.name)) throw new Error(`refusing private settings, cache or credentials: ${entry.name}`)
    const path = join(directory, entry.name)
    const realPath = entry.isSymbolicLink() ? realpathSync(path) : path
    const realRelative = relative(source, realPath)
    if (realRelative.startsWith('..') || isAbsolute(realRelative)) throw new Error('a tool symlink resolves outside its locked directory')
    const stat = statSync(realPath)
    const name = join(virtual, entry.name).split(sep).join('/')
    if (stat.isDirectory()) walk(realPath, join(virtual, entry.name), nextAncestors)
    else if (stat.isFile()) {
      const size = stat.size
      bytes += size
      if (++count > 500_000 || bytes > 16 * 1024 ** 3) throw new Error('tool tree exceeds the locking limit')
      files[name] = digest(realPath)
    } else throw new Error(`tool tree contains a special file: ${entry.name}`)
  }
}
for (const name of ['node', 'git', 'python', 'LICENSES']) if (!existsSync(join(source, name))) throw new Error(`tool root must contain ${name}/`)
walk(source)
const manifest = { schemaVersion: 1, platform, ...metadata, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) }
const output = join(source, 'manifest.json')
if (existsSync(output) || lstatSync(source).isSymbolicLink()) throw new Error('manifest already exists or tool root is a link')
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
process.stdout.write(`Toolchain locked: ${platform}; ${count} files; ${bytes} bytes\n`)
