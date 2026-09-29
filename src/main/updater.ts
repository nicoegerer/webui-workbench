import { autoUpdater, type UpdateInfo } from 'electron-updater'
import log from 'electron-log'
import { app, BrowserWindow } from 'electron'

let mainWin: BrowserWindow | null = null
let initialized = false
let pendingCheck: Promise<void> | null = null
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const send = (type: string, data?: unknown): void => {
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
    mainWin.webContents.send('main:data', { type, data })
  }
}

export function initUpdater(window: BrowserWindow): void {
  mainWin = window
  if (initialized) return
  initialized = true

  autoUpdater.logger = log
  // Updates come from this fork's tested release feed, never an upstream ZIP.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    send('update:checking')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', () => {
    send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', () => {
    send('update:downloaded')
  })

  autoUpdater.on('error', (error: Error) => {
    send('update:error', { message: error?.message ?? 'Update error' })
  })

  // Also check long-running sessions. Never quit/restart a working chat automatically.
  if (app.isPackaged) {
    const check = (): void => {
      void checkForUpdates().catch((err) => {
        log.warn('Automatic update check/download failed; will retry:', err)
      })
    }
    check()
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    timer.unref()
    app.once('before-quit', () => clearInterval(timer))
  }
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    log.info('Skipping update check — app is not packaged')
    send('update:not-available')
    return
  }
  if (!pendingCheck) {
    pendingCheck = (async () => {
      const result = await autoUpdater.checkForUpdates()
      // The download has a separate promise; handle network failures there too.
      await result?.downloadPromise
    })().finally(() => {
      pendingCheck = null
    })
  }
  await pendingCheck
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
