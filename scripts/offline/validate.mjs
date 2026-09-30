#!/usr/bin/env node
/**
 * Read-only preflight; Node builtins only. Run before packaging or Nginx upload:
 * node --import tsx/esm scripts/offline/validate.mjs config offline/profiles/superbpm.json
 * node --import tsx/esm scripts/offline/validate.mjs manifest manifest.json https://host/releases/manifest.json
 * No input values, URLs or JSON parse errors are printed.
 */
import { readFileSync } from 'node:fs'
import { validateOfflineBuildConfig, validateOfflineManifest } from '../../src/offlineContracts.ts'

const [kind, file, manifestUrl, ...extra] = process.argv.slice(2)
try {
  if (!file || extra.length || !['config', 'manifest'].includes(kind) || (kind === 'config' && manifestUrl) || (kind === 'manifest' && !manifestUrl)) {
    throw new Error('Usage: validate.mjs config <file> | manifest <file> <HTTPS manifest URL>')
  }
  let value
  try {
    const bytes = readFileSync(file)
    if (bytes.length > 1024 * 1024) throw new Error()
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Offline input must be readable JSON no larger than 1 MiB')
  }
  if (kind === 'config') validateOfflineBuildConfig(value)
  else validateOfflineManifest(value, { manifestUrl })
  console.log(`Offline ${kind} valid`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
