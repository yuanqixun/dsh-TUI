#!/usr/bin/env node
/** Exercise the real HTTPS static-file path through an existing Nginx container image. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const image = process.env.OFFLINE_NGINX_IMAGE
if (!image) throw new Error('Set OFFLINE_NGINX_IMAGE to a locally available Nginx image; this check does not pull images')
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'offline nginx fixture '))
const name = `dsh-tui-nginx-${randomUUID().slice(0, 8)}`
const web = join(root, 'web')
const configDirectory = join(root, 'nginx')
const certificates = join(root, 'certificates')
const install = join(root, 'install')
const data = join(root, 'data')
const fixture = join(root, 'release')
const archive = join(web, 'updates', 'dsh-tui-0.11.2-kylin-v10-x64.tar.gz')
const manifestPath = join(web, 'updates', 'manifest.json')
const distributionId = process.env.OFFLINE_NGINX_DISTRIBUTION_ID ?? 'hxfl'
if (!['superbpm', 'hxfl'].includes(distributionId)) throw new Error('OFFLINE_NGINX_DISTRIBUTION_ID must be superbpm or hxfl')
const platform = 'kylin-v10-x64'
const toolchainId = `${distributionId}-${platform}-nginx-fixture`
let containerStarted = false

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

try {
  execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' })
  for (const path of [join(web, 'updates'), configDirectory, certificates, join(install, 'app', 'releases', '0.11.1'), join(install, 'config'), join(install, 'launcher'), join(install, 'tools', 'python', 'bin'), data, fixture]) mkdirSync(path, { recursive: true })
  writeFileSync(join(configDirectory, 'default.conf'), `server {
  listen 443 ssl;
  server_name localhost;
  ssl_certificate /etc/nginx/certs/tls.crt;
  ssl_certificate_key /etc/nginx/certs/tls.key;
  root /usr/share/nginx/html;
  location / { try_files $uri =404; }
}
`)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes',
    '-keyout', join(certificates, 'tls.key'), '-out', join(certificates, 'tls.crt'),
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { stdio: 'ignore' })

  const releaseFiles = {
    'index.js': "process.send?.({ type: 'dsh-tui-offline-ready' })\n",
    'cordis.patch.yml': 'plugins: []\n',
  }
  for (const [path, contents] of Object.entries(releaseFiles)) writeFileSync(join(fixture, path), contents)
  writeFileSync(join(fixture, 'offline-release.json'), `${JSON.stringify({
    schemaVersion: 1,
    distributionId,
    version: '0.11.2',
    toolchainId,
    entry: 'index.js',
    files: Object.fromEntries(Object.entries(releaseFiles).map(([path, contents]) => [path, digest(Buffer.from(contents))])),
  }, null, 2)}\n`)
  execFileSync('python3', [join(repository, 'scripts', 'offline', 'archive.py'), 'tar.gz', fixture, archive])
  const archiveBytes = readFileSync(archive)

  execFileSync('docker', [
    'run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::443',
    '--mount', `type=bind,source=${web},destination=/usr/share/nginx/html,readonly`,
    '--mount', `type=bind,source=${configDirectory}/default.conf,destination=/etc/nginx/conf.d/default.conf,readonly`,
    '--mount', `type=bind,source=${certificates},destination=/etc/nginx/certs,readonly`,
    image,
  ], { stdio: 'ignore' })
  containerStarted = true
  const address = execFileSync('docker', ['port', name, '443/tcp'], { encoding: 'utf8' }).trim()
  const manifestUrl = `https://${address.replace(/^127\.0\.0\.1/u, 'localhost')}/updates/manifest.json`
  const manifest = {
    schemaVersion: 1,
    version: '0.11.2',
    sourceCommit: 'a'.repeat(40),
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    releaseNotes: 'Local Nginx static update fixture',
    platforms: {
      [platform]: {
        url: './dsh-tui-0.11.2-kylin-v10-x64.tar.gz',
        sizeBytes: archiveBytes.length,
        sha256: digest(archiveBytes),
        requiredToolchainId: toolchainId,
      },
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const currentRelease = join(install, 'app', 'releases', '0.11.1')
  writeFileSync(join(currentRelease, 'offline-release.json'), '{}\n')
  writeFileSync(join(install, 'app', 'active.json'), '{"version":"0.11.1"}\n')
  writeFileSync(join(install, 'config', 'offline.json'), `${JSON.stringify({
    schemaVersion: 1,
    distributionId,
    platform,
    toolchainId,
    modelApiBaseUrl: 'https://model.internal/v1',
    manifestUrl,
    maxUpdateBytes: 1024 * 1024,
    npmRegistry: 'https://npm.internal/',
    pythonIndexUrl: 'https://pypi.internal/simple/',
  }, null, 2)}\n`)
  writeFileSync(join(install, 'launcher', 'extract.py'), readFileSync(join(repository, 'scripts', 'offline', 'extract.py')))
  const python = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim()
  symlinkSync(python, join(install, 'tools', 'python', 'bin', 'python3'))
  const activeEnvironment = {
    ...process.env,
    DSH_TUI_OFFLINE: '1',
    DSH_TUI_OFFLINE_DISTRIBUTION_ID: distributionId,
    DSH_TUI_OFFLINE_ROOT: install,
    DSH_TUI_OFFLINE_HOME: data,
    DSH_TUI_OFFLINE_PLATFORM: platform,
    DSH_TUI_OFFLINE_TOOLCHAIN_ID: toolchainId,
    DSH_TUI_OFFLINE_MANIFEST_URL: manifestUrl,
    DSH_TUI_OFFLINE_MODEL_API_BASE_URL: 'https://model.internal/v1',
    DSH_TUI_OFFLINE_MAX_UPDATE_BYTES: '1048576',
    NODE_EXTRA_CA_CERTS: join(certificates, 'tls.crt'),
  }
  const modulePath = join(repository, 'src', 'offlineUpdate.ts')
  const inline = `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { resolveOfflineUpdateTarget, installOfflineUpdate } from ${JSON.stringify(modulePath)}; const target = await resolveOfflineUpdateTarget(); assert.equal(target.kind, 'update'); assert.equal(target.latest, '0.11.2'); assert.equal(target.assetUrl, ${JSON.stringify(manifestUrl.replace(/manifest\.json$/u, 'dsh-tui-0.11.2-kylin-v10-x64.tar.gz'))}); await installOfflineUpdate(target); assert.deepEqual(JSON.parse(readFileSync(${JSON.stringify(join(install, 'app', 'active.json'))}, 'utf8')), { version: '0.11.2', previousVersion: '0.11.1' }); console.log('HTTPS Nginx manifest discovery and release download/install passed')`
  let reachable = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      execFileSync('curl', ['--fail', '--silent', '--show-error', '--cacert', join(certificates, 'tls.crt'), manifestUrl], { stdio: 'ignore' })
      reachable = true
      break
    } catch { await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  assert.equal(reachable, true, 'Nginx HTTPS fixture did not become reachable')
  execFileSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', inline], { cwd: repository, env: activeEnvironment, stdio: 'inherit' })
  assert.equal(readFileSync(join(install, 'app', 'releases', '0.11.2', 'index.js'), 'utf8'), releaseFiles['index.js'])
  assert.equal(readFileSync(join(install, 'app', 'active.json'), 'utf8').includes('previousVersion'), true)
} finally {
  if (containerStarted) {
    try { execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' }) } catch {}
  }
  rmSync(root, { recursive: true, force: true })
}
