#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateOfflineBuildConfig, validateOfflineManifest, validateOfflineRuntimeConfig } from '../src/offlineContracts.ts'

const config = JSON.parse(readFileSync(new URL('../offline/profiles/hxfl.example.json', import.meta.url), 'utf8'))
const superbpmConfig = JSON.parse(readFileSync(new URL('../offline/profiles/superbpm.example.json', import.meta.url), 'utf8'))
assert.equal(config.distributionId, 'hxfl')
assert.equal(superbpmConfig.distributionId, 'superbpm')
assert.throws(() => validateOfflineBuildConfig(config), /Invalid offline field/u)
const configured = {
  ...config,
  modelApiBaseUrl: 'https://model.corp.example/v1',
  npmRegistry: 'https://npm.corp.example/',
  pythonIndexUrl: 'https://pypi.corp.example/simple/',
  manifestUrl: 'https://updates.corp.example/dsh-tui/manifest.json',
  releaseNotes: 'Test release',
  toolchains: Object.fromEntries(Object.entries(config.toolchains).map(([platform, value]) => [platform, {
    ...value,
    nodeVersion: '22.19.0',
    gitVersion: '2.45.2',
    pythonVersion: '3.12.8',
    platformBaseline: `${platform}-validated-baseline`,
    sourceDirectory: `offline/tools/${platform}`,
  }])),
}
assert.equal(validateOfflineBuildConfig(configured).manifestUrl, configured.manifestUrl)
assert.throws(() => validateOfflineBuildConfig({ ...configured, npmRegistry: 'https://user:secret@npm.corp.example/' }), /Invalid offline field/u)
assert.throws(() => validateOfflineBuildConfig({ ...configured, pythonIndexUrl: 'https://pypi.corp.example/simple/?token=secret' }), /Invalid offline field/u)
const secretMarker = 'offline-config-secret-sentinel'
for (const key of ['apiKey', 'npmAuthToken', 'password']) {
  assert.throws(() => validateOfflineBuildConfig({ ...configured, [key]: secretMarker }), error => {
    assert.match(error.message, /Invalid offline field/u)
    assert.equal(error.message.includes(secretMarker), false)
    return true
  })
}
for (const profile of ['superbpm', 'hxfl']) {
  const profileConfig = JSON.parse(readFileSync(new URL(`../offline/profiles/${profile}.json`, import.meta.url), 'utf8'))
  assert.equal(Object.keys(profileConfig).some(key => /key|token|password|secret|credential/iu.test(key)), false)
}
assert.throws(() => validateOfflineBuildConfig({
  ...configured,
  toolchains: Object.fromEntries(Object.entries(configured.toolchains).map(([platform, value]) => [platform, {
    ...value,
    sourceDirectory: '../outside',
  }])),
}), /Invalid offline field/u)

const manifestUrl = configured.manifestUrl
const toolchainId = 'hxfl-win10-x64-tools-a1b2c3'
const asset = {
  url: './dsh-tui-hxfl-1.2.3-win10-x64.zip',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  requiredToolchainId: toolchainId,
}
const manifest = {
  schemaVersion: 1,
  version: '1.2.3',
  sourceCommit: 'a'.repeat(40),
  publishedAt: '2026-09-30T00:00:00Z',
  releaseNotes: 'Test release',
  platforms: { 'win10-x64': asset },
}
const target = validateOfflineManifest(manifest, {
  manifestUrl,
  platform: 'win10-x64',
  toolchainId: asset.requiredToolchainId,
  maxUpdateBytes: 2048,
})
assert.equal('resolvedUrl' in target ? target.resolvedUrl : undefined, 'https://updates.corp.example/dsh-tui/dsh-tui-hxfl-1.2.3-win10-x64.zip')

const runtimeConfig = validateOfflineRuntimeConfig({
  schemaVersion: 1,
  distributionId: 'hxfl',
  platform: 'win10-x64',
  toolchainId,
  modelApiBaseUrl: 'https://aigw.hxfl.com.cn/v1',
  manifestUrl,
  maxUpdateBytes: 2048,
  npmRegistry: 'https://repo.hxfl.com.cn/npm-public',
  pythonIndexUrl: 'https://repo.hxfl.com.cn/pypi/simple/',
  versions: {},
  releaseNotes: 'Test release',
})
assert.equal(runtimeConfig.distributionId, 'hxfl')
assert.throws(() => validateOfflineRuntimeConfig({ ...runtimeConfig, distributionId: 'superbpm' }), /Invalid offline field/u)
assert.throws(() => validateOfflineRuntimeConfig({ ...runtimeConfig, apiKey: secretMarker }), error => {
  assert.match(error.message, /Invalid offline field/u)
  assert.equal(error.message.includes(secretMarker), false)
  return true
})

const invalidManifests = [
  { ...manifest, platforms: { ...manifest.platforms, unknown: asset } },
  { ...manifest, version: 'latest' },
  { ...manifest, publishedAt: '2026-02-30T00:00:00Z' },
  { ...manifest, platforms: { 'win10-x64': { ...asset, url: 'https://attacker.example/update.zip' } } },
  { ...manifest, platforms: { 'win10-x64': { ...asset, url: './wrong-platform.tar.gz' } } },
  { ...manifest, platforms: { 'win10-x64': { ...asset, sizeBytes: 2049 } } },
  { ...manifest, platforms: { 'win10-x64': { ...asset, sha256: 'bad' } } },
]
for (const value of invalidManifests) {
  assert.throws(() => validateOfflineManifest(value, { manifestUrl, maxUpdateBytes: 2048 }), /Invalid offline field/u)
}
assert.throws(() => validateOfflineManifest(manifest, {
  manifestUrl,
  platform: 'win10-x64',
  toolchainId: 'different-toolchain',
}), /toolchain mismatch/u)

// Exercise the production offline routing with a temporary bundle root and
// mocked HTTPS responses. No public registry/GitHub request may occur, even
// when the configured Nginx manifest is malformed or unavailable.
const { resolveTuiUpdateTarget } = await import('../src/update.ts')
const offlineRoot = mkdtempSync(join(tmpdir(), 'verify-offline-update-'))
const savedEnvironment = new Map(['DSH_TUI_OFFLINE', 'DSH_TUI_OFFLINE_DISTRIBUTION_ID', 'DSH_TUI_OFFLINE_ROOT', 'DSH_TUI_OFFLINE_HOME', 'DSH_TUI_OFFLINE_PLATFORM', 'DSH_TUI_OFFLINE_TOOLCHAIN_ID', 'DSH_TUI_OFFLINE_MANIFEST_URL', 'DSH_TUI_OFFLINE_MODEL_API_BASE_URL', 'DSH_TUI_OFFLINE_MAX_UPDATE_BYTES'].map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const requestedUrls = []
try {
  const configDir = join(offlineRoot, 'config')
  mkdirSync(configDir, { recursive: true })
  const testToolchainId = 'hxfl-win10-x64-tools-a1b2c3'
  const configuredManifestUrl = 'https://updates.corp.example/dsh-tui/manifest.json'
  const modelApiBaseUrl = 'https://model.corp.example/v1'
  const maxUpdateBytes = 2048
  writeFileSync(join(configDir, 'offline.json'), JSON.stringify({
    schemaVersion: 1,
    distributionId: 'hxfl',
    platform: 'win10-x64',
    toolchainId: testToolchainId,
    modelApiBaseUrl,
    manifestUrl: configuredManifestUrl,
    maxUpdateBytes,
    npmRegistry: 'https://npm.corp.example/',
    pythonIndexUrl: 'https://pypi.corp.example/simple/',
  }))
  Object.assign(process.env, {
    DSH_TUI_OFFLINE: '1',
    DSH_TUI_OFFLINE_DISTRIBUTION_ID: 'hxfl',
    DSH_TUI_OFFLINE_ROOT: offlineRoot,
    DSH_TUI_OFFLINE_HOME: join(offlineRoot, 'user-data'),
    DSH_TUI_OFFLINE_PLATFORM: 'win10-x64',
    DSH_TUI_OFFLINE_TOOLCHAIN_ID: testToolchainId,
    DSH_TUI_OFFLINE_MANIFEST_URL: configuredManifestUrl,
    DSH_TUI_OFFLINE_MODEL_API_BASE_URL: modelApiBaseUrl,
    DSH_TUI_OFFLINE_MAX_UPDATE_BYTES: String(maxUpdateBytes),
  })
  globalThis.fetch = async input => {
    const url = String(input)
    requestedUrls.push(url)
    const bytes = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      version: '0.11.2',
      sourceCommit: 'a'.repeat(40),
      publishedAt: '2026-09-30T00:00:00Z',
      releaseNotes: 'Offline test release',
      platforms: { 'win10-x64': { ...asset, url: './dsh-tui-hxfl-0.11.2-win10-x64.zip', requiredToolchainId: testToolchainId } },
    }))
    const response = new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  const routed = await resolveTuiUpdateTarget()
  assert.equal(routed.kind, 'update')
  assert.equal(routed.latest, '0.11.2')
  assert.deepEqual(requestedUrls, [configuredManifestUrl])

  requestedUrls.length = 0
  globalThis.fetch = async input => {
    const url = String(input)
    requestedUrls.push(url)
    const response = new Response('{broken json', { headers: { 'content-length': '12' } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  const failed = await resolveTuiUpdateTarget()
  assert.equal(failed.kind, 'unknown')
  assert.deepEqual(requestedUrls, [configuredManifestUrl])

  const responseFor = (url, body, contentLength = Buffer.byteLength(body)) => {
    const response = new Response(body, { headers: { 'content-length': String(contentLength) } })
    Object.defineProperty(response, 'url', { value: url })
    return response
  }
  const noPlatformManifest = {
    ...manifest,
    platforms: {
      'kylin-v10-x64': {
        ...asset,
        url: './dsh-tui-hxfl-1.2.3-kylin-v10-x64.tar.gz',
      },
    },
  }
  const oversizedAssetManifest = {
    ...manifest,
    platforms: { 'win10-x64': { ...asset, sizeBytes: maxUpdateBytes + 1 } },
  }
  const badResponses = [
    async () => { throw new Error('simulated update timeout') },
    async url => responseFor(url, 'x', 1024 * 1024 + 1),
    async url => responseFor(url, 'short body', 11),
    async url => responseFor(url, JSON.stringify(noPlatformManifest)),
    async url => responseFor(url, JSON.stringify(oversizedAssetManifest)),
  ]
  for (const fetchFixture of badResponses) {
    requestedUrls.length = 0
    globalThis.fetch = async input => {
      const url = String(input)
      requestedUrls.push(url)
      return fetchFixture(url)
    }
    const rejected = await resolveTuiUpdateTarget()
    assert.equal(rejected.kind, 'unknown')
    assert.deepEqual(requestedUrls, [configuredManifestUrl])
  }
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(offlineRoot, { recursive: true, force: true })
}

process.stdout.write('offline contracts verified (config placeholders, secret-free build/runtime inputs, manifest schema, origin, size, checksum, platform, toolchain, Nginx-only update routing)\n')
