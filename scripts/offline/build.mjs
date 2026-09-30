#!/usr/bin/env node
/** Validate one local environment profile, run the repo build, then package it. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOfflineBuildConfig } from '../../src/offlineContracts.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const profileAt = args.indexOf('--profile')
const profile = profileAt < 0 ? undefined : args[profileAt + 1]
if (profile !== 'superbpm' && profile !== 'hxfl') {
  console.error('Usage: pnpm offline:build -- --profile <superbpm|hxfl> --platform <target> [--out <empty-directory>]')
  process.exit(2)
}
let config
try {
  config = validateOfflineBuildConfig(JSON.parse(readFileSync(join(root, 'offline', 'profiles', `${profile}.json`), 'utf8')))
  if (config.distributionId !== profile) throw new Error()
} catch {
  throw new Error(`offline/profiles/${profile}.json is incomplete; copy the matching example and fill the locked toolchain inputs`)
}
const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
const packageBuild = spawnSync(process.execPath, [join(root, 'scripts', 'make-offline-bundles.mjs'), ...args], { cwd: root, stdio: 'inherit' })
if (packageBuild.error) throw packageBuild.error
process.exit(packageBuild.status ?? 1)
