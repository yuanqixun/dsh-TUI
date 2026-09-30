import { restorePreviousRelease } from './rollback.mjs'

export function watchReleaseStartup({
  child,
  active,
  activeFile,
  releasesDirectory,
  timeoutMs = 120_000,
  message,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onExit,
}) {
  let ready = false
  let settled = false
  const startupTimeout = setTimer(() => {
    if (!ready) rollback('the new version did not finish starting')
  }, timeoutMs)

  function rollback(reason) {
    if (ready || settled) return
    settled = true
    clearTimer(startupTimeout)
    try {
      const result = restorePreviousRelease({ active, activeFile, releasesDirectory })
      if (result.restored) message(`${reason}; restored ${result.version}`)
      else message(`${reason}; keep current release ${result.version}`)
    } catch {
      message(`${reason}; please select the previous release manually`)
    }
    child.kill()
  }

  child.on('message', value => {
    if (!settled && value && value.type === 'dsh-tui-offline-ready') {
      ready = true
      settled = true
      clearTimer(startupTimeout)
    }
  })
  child.on('error', () => rollback('the new version could not launch'))
  child.on('exit', (code, signal) => {
    clearTimer(startupTimeout)
    if (!ready && !settled) rollback('the new version exited during startup')
    onExit(code, signal)
  })

  return { rollback }
}
