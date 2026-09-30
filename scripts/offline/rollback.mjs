import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const releaseVersionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u

export function restorePreviousRelease({ active, activeFile, releasesDirectory, processId = process.pid }) {
  const previousVersion = active.previousVersion
  if (typeof previousVersion !== 'string' || !releaseVersionPattern.test(previousVersion)
    || !existsSync(join(releasesDirectory, previousVersion, 'offline-release.json'))) {
    return { restored: false, version: active.version }
  }

  const pointer = `${JSON.stringify({ version: previousVersion }, null, 2)}\n`
  const temporary = `${activeFile}.${processId}.tmp`
  writeFileSync(temporary, pointer, { flag: 'wx', mode: 0o600 })
  renameSync(temporary, activeFile)
  return { restored: true, version: previousVersion }
}
