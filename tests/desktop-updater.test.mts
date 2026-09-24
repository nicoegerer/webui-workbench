import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/main/updater.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'electron-updater', 'electron-log']
})
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve))
}

type CheckResult = { downloadPromise: Promise<unknown> }
type UpdaterApi = { initUpdater: (window: unknown) => void; checkForUpdates: () => Promise<void> }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Keep inferred test-fixture types.
const fixture = (packaged = true) => {
  const app = Object.assign(new EventEmitter(), { isPackaged: packaged })
  const events: string[] = []
  const warnings: unknown[] = []
  const timers: { callback: () => void; delay: number; unrefed: boolean; cleared: boolean }[] = []
  let checks = 0,
    installs = 0
  let checkResult: () => Promise<CheckResult> = async () => ({
    downloadPromise: Promise.resolve([])
  })
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: () => {
      checks++
      return checkResult()
    },
    downloadUpdate: async () => [],
    quitAndInstall: () => {
      installs++
    },
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: true
  })
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, data: { type: string }) => events.push(data.type)
    }
  }
  const mod = { exports: {} as UpdaterApi }
  new Function(
    'require',
    'module',
    'exports',
    'setInterval',
    'clearInterval',
    built.outputFiles![0].text
  )(
    (name: string) =>
      name === 'electron'
        ? { app }
        : name === 'electron-updater'
          ? { autoUpdater: updater }
          : name === 'electron-log'
            ? { info: () => undefined, warn: (...args: unknown[]) => warnings.push(args) }
            : require(name),
    mod,
    mod.exports,
    (callback: () => void, delay: number) => {
      const timer = { callback, delay, unrefed: false, cleared: false }
      timers.push(timer)
      return Object.assign(timer, {
        unref: () => {
          timer.unrefed = true
        }
      })
    },
    (timer: { cleared: boolean }) => {
      timer.cleared = true
    }
  )
  return {
    api: mod.exports,
    app,
    updater,
    window,
    events,
    warnings,
    timers,
    checks: () => checks,
    installs: () => installs,
    setCheck: (fn: () => Promise<CheckResult>) => {
      checkResult = fn
    }
  }
}

test('packaged fork downloads automatically, checks periodically and never forces a restart', async () => {
  const f = fixture()
  f.api.initUpdater(f.window)
  await flush()
  assert.equal(f.checks(), 1)
  assert.equal(f.updater.autoDownload, true)
  assert.equal(f.updater.autoInstallOnAppQuit, true)
  assert.equal(f.updater.allowPrerelease, true, 'services releases are GitHub prereleases')
  assert.equal(f.updater.allowDowngrade, false)
  assert.equal(f.timers[0].delay, 6 * 60 * 60 * 1000)
  assert.equal(f.timers[0].unrefed, true)
  f.updater.emit('update-downloaded', {})
  assert.ok(f.events.includes('update:downloaded'))
  assert.equal(f.installs(), 0, 'download must not interrupt the current chat')
  f.timers[0].callback()
  await flush()
  assert.equal(f.checks(), 2)
  f.api.initUpdater(f.window)
  assert.equal(f.timers.length, 1)
  assert.equal(f.updater.listenerCount('update-available'), 1)
  f.app.emit('before-quit')
  assert.equal(f.timers[0].cleared, true)
})

test('download failures are handled and the next automatic check retries', async () => {
  const f = fixture()
  f.setCheck(async () => ({ downloadPromise: Promise.reject(new Error('offline')) }))
  f.api.initUpdater(f.window)
  await flush()
  assert.equal(f.warnings.length, 1)
  assert.equal(f.installs(), 0)
  f.setCheck(async () => ({ downloadPromise: Promise.resolve([]) }))
  f.timers[0].callback()
  await flush()
  assert.equal(f.checks(), 2)
})

test('manual and scheduled checks share an in-flight download', async () => {
  const f = fixture()
  let finish!: () => void
  const downloading = new Promise<void>((resolve) => {
    finish = resolve
  })
  f.setCheck(async () => ({ downloadPromise: downloading }))
  f.api.initUpdater(f.window)
  const manual = f.api.checkForUpdates()
  f.timers[0].callback()
  assert.equal(f.checks(), 1)
  finish()
  await manual
  await f.api.checkForUpdates()
  assert.equal(f.checks(), 2)
})

test('development sessions do not check or download updates', async () => {
  const f = fixture(false)
  f.api.initUpdater(f.window)
  await f.api.checkForUpdates()
  assert.equal(f.checks(), 0)
  assert.equal(f.timers.length, 0)
})
