/** Shared build and Nginx manifest validation for the offline distribution. */
export const OFFLINE_PLATFORMS = ['win10-x64', 'kylin-v10-x64', 'kylin-v10-arm64'] as const
export type OfflinePlatform = typeof OFFLINE_PLATFORMS[number]
export const OFFLINE_DISTRIBUTIONS = ['superbpm', 'hxfl'] as const
export type OfflineDistribution = typeof OFFLINE_DISTRIBUTIONS[number]
export const OFFLINE_MAX_UPDATE_BYTES = 8 * 1024 ** 3
export const OFFLINE_DEFAULT_MAX_UPDATE_BYTES = 1024 ** 3
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const sha256Pattern = /^[0-9a-f]{64}$/iu

function fail(field: string): never {
  throw new Error(`Invalid offline field: ${field}`)
}

function record(value: unknown, keys: readonly string[], field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(field)
  if (Object.keys(value).some(key => !keys.includes(key))) fail(field)
}

function safeText(value: unknown, field: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail(field)
}

function validateHttps(value: unknown, field: string, base?: URL): URL {
  safeText(value, field, 4096)
  if (value.trim() !== value || /[\\\s]/u.test(value)) fail(field)
  let url: URL
  try {
    url = base === undefined ? new URL(value) : new URL(value, base)
  } catch {
    return fail(field)
  }
  if (url.hostname.toLowerCase().endsWith('.invalid') || url.hostname.toLowerCase() === 'example.com') fail(field)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(field)
  return url
}

export interface OfflineToolchainInput {
  id: string
  nodeVersion: string
  gitVersion: string
  pythonVersion: string
  platformBaseline: string
  sourceDirectory: string
}
export interface OfflineBuildConfig {
  schemaVersion: 1
  distributionId: OfflineDistribution
  modelApiBaseUrl: string
  npmRegistry: string
  pythonIndexUrl: string
  manifestUrl: string
  releaseNotes: string
  maxUpdateBytes: number
  toolchains: Record<OfflinePlatform, OfflineToolchainInput>
}

export function validateOfflineBuildConfig(value: unknown): OfflineBuildConfig {
  record(value, ['schemaVersion', 'distributionId', 'modelApiBaseUrl', 'npmRegistry', 'pythonIndexUrl', 'manifestUrl', 'releaseNotes', 'maxUpdateBytes', 'toolchains'], 'config')
  if (value.schemaVersion !== 1) fail('schemaVersion')
  if (!OFFLINE_DISTRIBUTIONS.includes(value.distributionId as OfflineDistribution)) fail('distributionId')
  validateHttps(value.modelApiBaseUrl, 'modelApiBaseUrl')
  validateHttps(value.npmRegistry, 'npmRegistry')
  validateHttps(value.pythonIndexUrl, 'pythonIndexUrl')
  validateHttps(value.manifestUrl, 'manifestUrl')
  if (typeof value.releaseNotes !== 'string' || value.releaseNotes.length > 16384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.releaseNotes)) fail('releaseNotes')
  if (!Number.isSafeInteger(value.maxUpdateBytes) || Number(value.maxUpdateBytes) < 1 || Number(value.maxUpdateBytes) > OFFLINE_MAX_UPDATE_BYTES) fail('maxUpdateBytes')
  if (value.toolchains !== undefined) {
    record(value.toolchains, OFFLINE_PLATFORMS, 'toolchains')
    const ids = new Set<string>()
    for (const platform of OFFLINE_PLATFORMS) {
      const toolchain = value.toolchains[platform]
      if (toolchain === undefined) fail(`toolchains.${platform}`)
      record(toolchain, ['id', 'nodeVersion', 'gitVersion', 'pythonVersion', 'platformBaseline', 'sourceDirectory'], `toolchains.${platform}`)
      for (const key of ['id', 'nodeVersion', 'gitVersion', 'pythonVersion', 'platformBaseline', 'sourceDirectory']) safeText(toolchain[key], `toolchains.${platform}.${key}`, 4096)
      if (!String(toolchain.id).startsWith(`${value.distributionId}-`)) fail(`toolchains.${platform}.id`)
      const sourceDirectory = String(toolchain.sourceDirectory)
      if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(sourceDirectory) || sourceDirectory.split(/[\\/]/u).includes('..')) fail(`toolchains.${platform}.sourceDirectory`)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/u.test(String(toolchain.id))) fail(`toolchains.${platform}.id`)
      if (/待|填写|TODO|example\.(?:invalid|com|org|net)/iu.test(Object.values(toolchain).join(' '))) fail(`toolchains.${platform}`)
      if (ids.has(String(toolchain.id))) fail(`toolchains.${platform}.id`)
      ids.add(String(toolchain.id))
    }
  } else fail('toolchains')
  return value as unknown as OfflineBuildConfig
}

export interface OfflineRuntimeConfig {
  schemaVersion: 1
  distributionId: OfflineDistribution
  platform: OfflinePlatform
  toolchainId: string
  modelApiBaseUrl: string
  manifestUrl: string
  maxUpdateBytes: number
  npmRegistry: string
  pythonIndexUrl: string
}

export function validateOfflineRuntimeConfig(value: unknown): OfflineRuntimeConfig {
  record(value, ['schemaVersion', 'distributionId', 'platform', 'toolchainId', 'modelApiBaseUrl', 'manifestUrl', 'maxUpdateBytes', 'npmRegistry', 'pythonIndexUrl', 'versions', 'releaseNotes'], 'runtimeConfig')
  if (value.schemaVersion !== 1) fail('runtimeConfig.schemaVersion')
  if (!OFFLINE_DISTRIBUTIONS.includes(value.distributionId as OfflineDistribution)) fail('runtimeConfig.distributionId')
  if (!OFFLINE_PLATFORMS.includes(value.platform as OfflinePlatform)) fail('runtimeConfig.platform')
  safeText(value.toolchainId, 'runtimeConfig.toolchainId', 256)
  if (!String(value.toolchainId).startsWith(`${value.distributionId}-`)) fail('runtimeConfig.toolchainId')
  validateHttps(value.modelApiBaseUrl, 'runtimeConfig.modelApiBaseUrl')
  validateHttps(value.manifestUrl, 'runtimeConfig.manifestUrl')
  validateHttps(value.npmRegistry, 'runtimeConfig.npmRegistry')
  validateHttps(value.pythonIndexUrl, 'runtimeConfig.pythonIndexUrl')
  if (!Number.isSafeInteger(value.maxUpdateBytes) || Number(value.maxUpdateBytes) < 1 || Number(value.maxUpdateBytes) > OFFLINE_MAX_UPDATE_BYTES) fail('runtimeConfig.maxUpdateBytes')
  return value as unknown as OfflineRuntimeConfig
}

export interface OfflineManifestAsset {
  url: string
  sizeBytes: number
  sha256: string
  requiredToolchainId: string
}
export interface OfflineUpdateManifest {
  schemaVersion: 1
  version: string
  sourceCommit?: string
  publishedAt: string
  releaseNotes: string
  platforms: Partial<Record<OfflinePlatform, OfflineManifestAsset>>
}

export function validateOfflineManifest(
  value: unknown,
  options: { manifestUrl: string; platform?: OfflinePlatform; toolchainId?: string; maxUpdateBytes?: number },
): OfflineUpdateManifest | (OfflineManifestAsset & { version: string; releaseNotes: string; resolvedUrl: string }) {
  const base = validateHttps(options.manifestUrl, 'manifestUrl')
  const limit = options.maxUpdateBytes ?? OFFLINE_DEFAULT_MAX_UPDATE_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OFFLINE_MAX_UPDATE_BYTES) fail('maxUpdateBytes')
  record(value, ['schemaVersion', 'version', 'sourceCommit', 'publishedAt', 'releaseNotes', 'platforms'], 'manifest')
  if (value.schemaVersion !== 1) fail('schemaVersion')
  if (typeof value.version !== 'string' || value.version.length > 128 || !semverPattern.test(value.version)) fail('version')
  if (value.sourceCommit !== undefined && (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40,64}$/iu.test(value.sourceCommit))) fail('sourceCommit')
  if (typeof value.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(value.publishedAt)) fail('publishedAt')
  const publishedAt = new Date(value.publishedAt)
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString().replace('.000Z', 'Z') !== value.publishedAt) fail('publishedAt')
  if (typeof value.releaseNotes !== 'string' || value.releaseNotes.length > 16384 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.releaseNotes)) fail('releaseNotes')
  record(value.platforms, OFFLINE_PLATFORMS, 'platforms')
  if (Object.keys(value.platforms).length === 0) fail('platforms')
  const urls = new Map<OfflinePlatform, string>()
  for (const [key, rawAsset] of Object.entries(value.platforms)) {
    const platform = key as OfflinePlatform
    record(rawAsset, ['url', 'sizeBytes', 'sha256', 'requiredToolchainId'], `platforms.${key}`)
    const field = `platforms.${key}`
    if (typeof rawAsset.url !== 'string' || (!rawAsset.url.startsWith('./') && !rawAsset.url.startsWith('https://'))) fail(`${field}.url`)
    const url = validateHttps(rawAsset.url, `${field}.url`, base)
    if (url.origin !== base.origin || !url.pathname.endsWith(platform === 'win10-x64' ? '.zip' : '.tar.gz')) fail(`${field}.url`)
    if (!Number.isSafeInteger(rawAsset.sizeBytes) || Number(rawAsset.sizeBytes) < 1 || Number(rawAsset.sizeBytes) > limit) fail(`${field}.sizeBytes`)
    if (typeof rawAsset.sha256 !== 'string' || !sha256Pattern.test(rawAsset.sha256)) fail(`${field}.sha256`)
    if (typeof rawAsset.requiredToolchainId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(rawAsset.requiredToolchainId)) fail(`${field}.requiredToolchainId`)
    urls.set(platform, url.href)
  }
  const manifest = value as unknown as OfflineUpdateManifest
  if (options.platform === undefined) return manifest
  if (!OFFLINE_PLATFORMS.includes(options.platform)) fail('platform')
  const asset = manifest.platforms[options.platform]
  if (asset === undefined) fail('platform')
  if (asset.requiredToolchainId !== options.toolchainId) throw new Error('Offline toolchain mismatch: redeploy a complete installation bundle')
  return { ...asset, resolvedUrl: urls.get(options.platform)!, version: manifest.version, releaseNotes: manifest.releaseNotes }
}
