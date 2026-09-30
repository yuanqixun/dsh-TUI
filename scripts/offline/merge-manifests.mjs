#!/usr/bin/env node
/** Merge three independently built target-platform artifact directories. */
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OFFLINE_PLATFORMS, validateOfflineBuildConfig, validateOfflineManifest } from '../../src/offlineContracts.ts'

const args = process.argv.slice(2)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outAt = args.indexOf('--out')
const profileAt = args.indexOf('--profile')
const profile = profileAt < 0 ? undefined : args[profileAt + 1]
if (outAt < 0 || profileAt < 0 || (profile !== 'superbpm' && profile !== 'hxfl') || !args[outAt + 1] || outAt === profileAt || args.length !== 7) {
  console.error('Usage: node --import tsx/esm scripts/offline/merge-manifests.mjs --profile <superbpm|hxfl> --out <empty-dir> <win-dir> <kylin-x64-dir> <kylin-arm64-dir>')
  process.exit(2)
}
const output = resolve(args[outAt + 1])
const inputDirs = args.filter((_, index) => ![outAt, outAt + 1, profileAt, profileAt + 1].includes(index)).map(value => resolve(value))
if (existsSync(output)) throw new Error('Output directory already exists')
const documents = inputDirs.map(directory => JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')))
const buildRecords = inputDirs.map(directory => JSON.parse(readFileSync(join(directory, 'platform-manifest.json'), 'utf8')))
const versions = new Set(documents.map(manifest => manifest.version))
const notes = new Set(documents.map(manifest => manifest.releaseNotes))
const sourceCommits = new Set(documents.map(manifest => manifest.sourceCommit))
if (versions.size !== 1 || notes.size !== 1 || sourceCommits.size !== 1 || documents.some(manifest => manifest.schemaVersion !== 1 || !manifest.platforms || Object.keys(manifest.platforms).length !== 1)) throw new Error('Target builds must share one client version, source commit, and release note and each contain one platform')
if (buildRecords.some((record, index) => record.schemaVersion !== 1 || record.distributionId !== profile || record.productVersion !== documents[index].version || record.sourceCommit !== documents[index].sourceCommit || !documents[index].platforms[record.platform])) throw new Error('Target build records must belong to the selected distribution and match their update manifests')
if (new Set(buildRecords.map(record => record.platform)).size !== OFFLINE_PLATFORMS.length || OFFLINE_PLATFORMS.some(platform => !buildRecords.some(record => record.platform === platform))) throw new Error('Target build records do not cover exactly the three supported platforms')
const allAssets = Object.assign({}, ...documents.map(manifest => manifest.platforms))
if (OFFLINE_PLATFORMS.some(platform => !allAssets[platform]) || Object.keys(allAssets).length !== OFFLINE_PLATFORMS.length) throw new Error('Exactly one archive per supported platform is required')
const buildConfig = validateOfflineBuildConfig(JSON.parse(readFileSync(join(root, 'offline', 'profiles', `${profile}.json`), 'utf8')))
if (buildConfig.distributionId !== profile || OFFLINE_PLATFORMS.some(platform => !allAssets[platform].requiredToolchainId.startsWith(`${profile}-`))) throw new Error('Update archives do not match the selected distribution profile')
mkdirSync(output, { recursive: false })
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
const manifest = {
  schemaVersion: 1,
  version: documents[0].version,
  sourceCommit: documents[0].sourceCommit,
  publishedAt: new Date(Math.max(...documents.map(item => Date.parse(item.publishedAt)))).toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  releaseNotes: documents[0].releaseNotes,
  platforms: {},
}
for (let index = 0; index < documents.length; index += 1) {
  const directory = inputDirs[index]
  const manifestDoc = documents[index]
  for (const [platform, asset] of Object.entries(manifestDoc.platforms)) {
    const archiveName = basename(new URL(asset.url, 'https://offline.invalid/').pathname)
    const source = join(directory, archiveName)
    if (!existsSync(source) || statSync(source).size !== asset.sizeBytes || hashFile(source) !== asset.sha256) throw new Error(`Archive metadata or SHA-256 check failed for ${platform}`)
    copyFileSync(source, join(output, archiveName), 1)
    manifest.platforms[platform] = asset
  }
  for (const name of readdirSync(directory)) {
    if (name === 'manifest.json' || name === 'SHA256SUMS' || name === 'platform-manifest.json' || name.startsWith('dsh-tui-') && Object.values(manifestDoc.platforms).some(asset => basename(new URL(asset.url, 'https://offline.invalid/').pathname) === name)) continue
    if (name.startsWith(`dsh-tui-${profile}-`)) copyFileSync(join(directory, name), join(output, name), 1)
  }
}
validateOfflineManifest(manifest, { manifestUrl: buildConfig.manifestUrl, maxUpdateBytes: buildConfig.maxUpdateBytes })
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
const hashes = readdirSync(output).sort().map(name => `${hashFile(join(output, name))}  ${name}`).join('\n')
writeFileSync(join(output, 'SHA256SUMS'), `${hashes}\n`, { flag: 'wx' })
process.stdout.write(`Merged update directory written to ${output}\n`)
