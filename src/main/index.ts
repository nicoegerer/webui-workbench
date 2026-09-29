// @ts-nocheck

import {
  app,
  shell,
  session,
  clipboard,
  nativeImage,
  desktopCapturer,
  systemPreferences,
  BrowserWindow,
  globalShortcut,
  MessageChannelMain,
  Notification,
  Menu,
  ipcMain,
  Tray,
  dialog
} from 'electron'
import path, { join } from 'path'
import { readFile, statfs } from 'fs/promises'

import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import {
  getLogFilePath,
  checkUrlAndOpen,
  clearAllServerLogs,
  getConfig,
  getUserDataPath,
  getInstallDir,
  getServerLog,
  getServerPIDs,
  getServerPty,
  installPackage,
  installPython,
  isPackageInstalled,
  isPythonInstalled,
  getPackageVersion,
  backupOpenWebUIDatabase,
  uninstallPackage,
  isUvInstalled,
  openUrl,
  resetApp,
  setConfig,
  startServer,
  stopAllServers,
  uninstallPython,
  validateRemoteUrl,
  type AppConfig,
  type Connection
} from './utils'

import {
  startOpenTerminal,
  stopOpenTerminal,
  getOpenTerminalInfo,
  getOpenTerminalPty,
  getOpenTerminalLog,
  isOpenTerminalService,
  validateOpenTerminalProcess,
  listWorkspaceTerminals,
  startWorkspaceTerminal,
  stopWorkspaceTerminal,
  stopAllWorkspaceTerminals,
  setActiveWorkspaceTerminal,
  workspaceTerminalId
} from './utils/open-terminal'

import {
  setupLlamaCpp,
  startLlamaCpp,
  stopLlamaCpp,
  getLlamaCppInfo,
  getLlamaCppLog,
  getLlamaCppPty,
  validateLlamaCppProcess,
  checkLlamaCppUpdate,
  updateLlamaCpp,
  uninstallLlamaCpp
} from './utils/llamacpp'

import {
  listModels,
  downloadModel,
  deleteModel,
  cancelDownload,
  getModelsDir,
  searchModels,
  getRepoFiles
} from './utils/huggingface'

import { initializeManagedServices, getManagedServicesManager } from './services'
import { WorkspacePreviewError, WorkspacePreviewManager } from './services/workspace-preview'
import { createWorkspacePreviewHandlers } from './services/workspace-preview-ipc'
import { canReleaseWorkspaceTerminal } from '../shared/services/workspace-lifecycle'
import {
  getWorkspacePreviewRequestHeaders,
  isWorkspacePreviewNavigationAllowed
} from '../shared/workspace-preview'
import {
  configureGithubFs,
  getGithubPreviewSource,
  listGithubMounts,
  listGithubPreviewWorkspaces,
  mountGithubRepo,
  stopGithubFs,
  unmountGithubRepos
} from './services/github-fs'

import {
  cancelOpenWebUISync,
  configureOpenWebUISync,
  scheduleOpenWebUISync,
  syncOpenWebUI
} from './services/open-webui-sync'

import {
  listGithubRepositories,
  listWorkspaces,
  rememberWorkspace,
  setWorkspaceActive
} from './utils/workspaces'

import { initUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater'
import runtimeVersions from '../shared/runtime-versions.json'
import { runtimeUpgradeVersion } from '../shared/services/runtime-update'
import {
  FORK_NAME,
  FORK_APP_ID,
  FORK_PROFILE_DIRECTORY,
  FORK_REPOSITORY
} from '../shared/fork-info'

// Isolate this distribution before any profile, log, service or session is opened.
// Never silently adopt a user's existing Open WebUI Desktop installation.
app.setName(FORK_NAME)
app.setPath('userData', join(app.getPath('appData'), FORK_PROFILE_DIRECTORY))

import log from 'electron-log'
log.transports.file.resolvePathFn = () => getLogFilePath('main')

import icon from '../../resources/icon.png?asset'

import { existsSync, writeFileSync, unlinkSync } from 'fs'

const workspacePreviewManager = new WorkspacePreviewManager()
const workspacePreview = createWorkspacePreviewHandlers({
  manager: workspacePreviewManager,
  listTerminals: () => [...listWorkspaceTerminals(), ...listGithubPreviewWorkspaces()],
  getRemoteSource: getGithubPreviewSource,
  // Generated pages have no IPC bridge; only the desktop's own main frame may request previews.
  isTrustedSender: (event) =>
    Boolean(
      mainWindow &&
      !mainWindow.isDestroyed() &&
      event?.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame
    ),
  describeError: (cause) =>
    cause instanceof WorkspacePreviewError
      ? { ok: false, code: cause.code, error: cause.message }
      : { ok: false, code: 'PREVIEW_START_FAILED', error: 'The website preview could not start.' }
})

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')

  // Use /tmp when container or AppImage restrictions make /dev/shm inaccessible.
  app.commandLine.appendSwitch('disable-dev-shm-usage')

  // Native Wayland is required for xdg-desktop-portal shortcuts.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

  // Software rendering avoids driver/shared-memory failures while retaining webview compositing.
  // Disabling the GPU or moving it in-process leaves webviews blank.
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')

  // The Linux GPU sandbox can fail shared-memory setup; the browser is already unsandboxed.
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Persist fatal GPU sandbox failures so the next launch can recover without shortcut edits.

const gpuCrashMarkerPath = join(app.getPath('userData'), '.gpu-sandbox-disabled')
const gpuSandboxDisabled = existsSync(gpuCrashMarkerPath)

if (gpuSandboxDisabled) {
  log.info('GPU sandbox disabled due to previous GPU process crash')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// Prevent Chromium from permanently blocking WebGL / 3-D APIs after
// repeated GPU process crashes within the same session.
app.disableDomainBlockingFor3DAPIs()


let mainWindow: BrowserWindow | null = null
let contentWindow: BrowserWindow | null = null
let spotlightWindow: BrowserWindow | null = null
let voiceInputWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuiting = false

let CONFIG: AppConfig | null = null
let SERVER_URL: string | null = null
let SERVER_STATUS: string | null = null
let SERVER_REACHABLE = false
let SERVER_PID: number | null = null
let AUTH_TOKEN: string | null = null
let voiceInputRecording = false


/** Flatpak needs an exposed shortcut portal; other environments report registration failures individually. */
function isGlobalShortcutSupported(): boolean {
  if (process.platform !== 'linux') return true

  // Let each registration report failure rather than disabling all X11/Wayland shortcuts.
  return true
}

function tryRegisterShortcut(
  accel: string,
  label: string,
  callback: () => void,
  silent = false
): boolean {
  try {
    const ok = globalShortcut.register(accel, callback)
    if (ok) {
      log.info(`${label} shortcut "${accel}" registered`)
      return true
    }
    log.warn(`${label} shortcut "${accel}" could not be registered (returned false)`)
    if (!silent) {
      new Notification({
        title: label,
        body: `Could not register shortcut "${accel}". It may be in use by another application.`
      }).show()
    }
    return false
  } catch (error) {
    log.warn(`${label} shortcut "${accel}" registration threw:`, error)
    if (!silent) {
      new Notification({
        title: label,
        body: `Failed to register shortcut "${accel}". It may conflict with another application.`
      }).show()
    }
    return false
  }
}

const registerShortcuts = (
  globalAccel?: string,
  spotlightAccel?: string,
  voiceInputAccel?: string,
  callAccel?: string
): void => {
  globalShortcut.unregisterAll()

  if (!isGlobalShortcutSupported()) {
    log.info(
      'Global shortcut registration skipped — unsupported environment ' +
        `(XDG_SESSION_TYPE=${process.env['XDG_SESSION_TYPE'] ?? '(unset)'}, ` +
        `FLATPAK_ID=${process.env['FLATPAK_ID'] ?? '(unset)'})`
    )
    return
  }

  if (globalAccel) {
    tryRegisterShortcut(globalAccel, 'Open WebUI', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createMainWindow()
      }
    })
  }

  if (spotlightAccel) {
    tryRegisterShortcut(spotlightAccel, 'Spotlight', () => {
      const text =
        CONFIG?.spotlightClipboardPaste !== false ? clipboard.readText()?.trim() || '' : ''
      toggleSpotlight(text)
    })
  }

  if (voiceInputAccel && CONFIG?.voiceInputEnabled !== false) {
    tryRegisterShortcut(voiceInputAccel, 'Voice Input', () => {
      toggleVoiceInput()
    })
  } else {
    log.info(
      `Voice input shortcut skipped — accel="${voiceInputAccel}", enabled=${CONFIG?.voiceInputEnabled}`
    )
  }

  if (callAccel && CONFIG?.callEnabled !== false) {
    tryRegisterShortcut(callAccel, 'Call', () => {
      toggleCall()
    })
  } else {
    log.info(`Call shortcut skipped — accel="${callAccel}", enabled=${CONFIG?.callEnabled}`)
  }
}

let spotlightBarOffset: { x: number; y: number } | null = null

function loadSpotlightPosition(): void {
  if (CONFIG?.spotlightPosition) {
    spotlightBarOffset = { ...CONFIG.spotlightPosition }
  }
}

function createSpotlightWindow(): BrowserWindow {
  const { screen } = require('electron')
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw, height: sh } = activeDisplay.bounds

  spotlightWindow = new BrowserWindow({
    x: sx,
    y: sy,
    width: sw,
    height: sh,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    // Ensure the window appears on whichever Space/desktop the user is
    // currently on, rather than pulling them back to the primary Space.
    visibleOnAllWorkspaces: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/spotlight-preload.js'),
      sandbox: false,
      webviewTag: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    spotlightWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/spotlight.html`)
  } else {
    spotlightWindow.loadFile(join(__dirname, '../renderer/spotlight.html'))
  }

  // Hide on blur — but only when the window was truly visible and settled.
  let blurArmed = false
  spotlightWindow.on('focus', () => {
    blurArmed = false
    setTimeout(() => {
      blurArmed = true
    }, 200)
  })
  spotlightWindow.on('blur', () => {
    if (blurArmed) {
      spotlightWindow?.hide()
    }
  })

  spotlightWindow.on('closed', () => {
    spotlightWindow = null
  })

  return spotlightWindow
}

function showAndFocusSpotlight(win: BrowserWindow, initialQuery?: string): void {
  // Focusing the app on macOS can switch Spaces; focus the all-workspaces window directly.
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
  }

  const { screen } = require('electron')
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw, height: sh } = activeDisplay.bounds
  win.setBounds({ x: sx, y: sy, width: sw, height: sh })

  // Hide main window so it doesn't appear behind the transparent overlay
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
  }

  win.show()
  win.focus()
  win.webContents.focus()

  win.webContents.send('spotlight:init', {
    barOffset: spotlightBarOffset,
    screenSize: { width: sw, height: sh },
    query: initialQuery || ''
  })
}

function toggleSpotlight(selectedText?: string): void {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    if (spotlightWindow.isVisible()) {
      spotlightWindow.hide()
    } else {
      showAndFocusSpotlight(spotlightWindow, selectedText)
    }
  } else {
    const win = createSpotlightWindow()
    win.once('ready-to-show', () => {
      showAndFocusSpotlight(win, selectedText)
    })
  }
}


function createVoiceInputWindow(): BrowserWindow {
  const { screen } = require('electron')
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  const { x: sx, y: sy, width: sw } = activeDisplay.bounds

  const winW = 340
  const winH = 72

  voiceInputWindow = new BrowserWindow({
    x: sx + Math.round((sw - winW) / 2),
    y: sy + 120,
    width: winW,
    height: winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    focusable: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/voice-input-preload.js'),
      sandbox: false,
      webviewTag: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  voiceInputWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === 'media')
    }
  )

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    voiceInputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/voice-input.html`)
  } else {
    voiceInputWindow.loadFile(join(__dirname, '../renderer/voice-input.html'))
  }

  voiceInputWindow.on('closed', () => {
    voiceInputWindow = null
    voiceInputRecording = false
  })

  return voiceInputWindow
}

function playChime(ascending: boolean): Promise<void> {
  return new Promise((resolve) => {
    const { execFile } = require('child_process')
    const fs = require('fs')
    const file = ascending ? 'chime-start.wav' : 'chime-stop.wav'
    const soundPath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'sounds', file)
      : join(app.getAppPath(), 'resources', 'sounds', file)

    const exists = fs.existsSync(soundPath)
    log.info(`playChime: ${ascending ? 'start' : 'stop'}, path=${soundPath}, exists=${exists}`)

    if (!exists) {
      resolve()
      return
    }

    if (process.platform === 'darwin') {
      execFile('afplay', [soundPath], (err, stdout, stderr) => {
        if (err) log.warn('afplay error:', err.message, stderr)
        resolve()
      })
    } else if (process.platform === 'win32') {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${soundPath}').PlaySync()`],
        () => resolve()
      )
    } else {
      execFile('paplay', [soundPath], (err) => {
        if (err) execFile('aplay', [soundPath], () => resolve())
        else resolve()
      })
    }
  })
}

async function toggleVoiceInput(): Promise<void> {
  if (voiceInputRecording) {
    // Stop recording — chime plays in done/close handler after mic is released
    voiceInputRecording = false
    if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
      voiceInputWindow.webContents.send('voiceInput:state', { recording: false })
    }
    return
  }

  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      if (!granted) {
        log.warn('Voice input: microphone permission denied')
        new Notification({
          title: 'Voice Input',
          body: 'Microphone access denied. Enable it in System Settings → Privacy & Security → Microphone, then restart the app.'
        }).show()
        return
      }
    }
  }

  try {
    const conn = await getDefaultConnection()
    if (!conn) {
      log.warn('Voice input: no connection configured')
      new Notification({
        title: 'Voice Input',
        body: 'No connection configured. Set up a connection in Settings before using voice input.'
      }).show()
      return
    }
  } catch (err: any) {
    log.warn('Voice input: config check failed:', err)
  }

  // Start recording — chime plays concurrently (separate audio output path from mic input)
  voiceInputRecording = true
  playChime(true)

  if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
    voiceInputWindow.show()
    voiceInputWindow.focus()
    voiceInputWindow.webContents.send('voiceInput:state', { recording: true })
  } else {
    const win = createVoiceInputWindow()
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
      setTimeout(() => {
        win.webContents.send('voiceInput:state', { recording: true })
      }, 100)
    })
  }
}


async function toggleCall(): Promise<void> {
  try {
    const conn = await getDefaultConnection()
    if (!conn) {
      log.warn('Call: no connection configured')
      new Notification({
        title: 'Call',
        body: 'No connection configured. Set up a connection in Settings before using the call shortcut.'
      }).show()
      return
    }

    const url = resolveConnectionUrl(conn)
    sendToRenderer('call', { connectionId: conn.id, url })

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  } catch (err: any) {
    log.warn('Call: config check failed:', err)
  }
}


const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 480
const MIN_WINDOW_HEIGHT = 360
const BOUNDS_SAVE_DEBOUNCE_MS = 500
const MIN_VISIBLE_OVERLAP_PX = 100

/** Last known non-maximized bounds, used to preserve restore geometry. */
let lastNormalBounds: Electron.Rectangle | null = null

let boundsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function debounceSaveWindowBounds(win: BrowserWindow): void {
  if (boundsDebounceTimer) clearTimeout(boundsDebounceTimer)
  boundsDebounceTimer = setTimeout(() => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const bounds = maximized ? (lastNormalBounds ?? win.getNormalBounds()) : win.getBounds()
    setConfig({ windowBounds: bounds, windowMaximized: maximized }).catch((err) =>
      log.warn('Failed to save window bounds:', err)
    )
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

/**
 * Returns true when at least `MIN_VISIBLE_OVERLAP_PX` of the saved
 * rectangle would be visible on one of the connected displays.
 */
function isBoundsOnVisibleDisplay(bounds: { x: number; y: number }): boolean {
  const { screen } = require('electron')
  const targetPoint = {
    x: bounds.x + MIN_VISIBLE_OVERLAP_PX / 2,
    y: bounds.y + MIN_VISIBLE_OVERLAP_PX / 2
  }
  const display = screen.getDisplayNearestPoint(targetPoint)
  const { x, y, width, height } = display.workArea
  return (
    bounds.x + MIN_VISIBLE_OVERLAP_PX > x &&
    bounds.x < x + width &&
    bounds.y + MIN_VISIBLE_OVERLAP_PX > y &&
    bounds.y < y + height
  )
}

function trackNormalBounds(win: BrowserWindow): void {
  if (!win.isDestroyed() && !win.isMaximized()) {
    lastNormalBounds = win.getBounds()
  }
}

function createMainWindow(show = true): void {
  const saved = CONFIG?.windowBounds
  const windowOpts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? DEFAULT_WINDOW_WIDTH,
    height: saved?.height ?? DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false,
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
    autoHideMenuBar: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    ...(process.platform === 'win32' ? { frame: true } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  }

  // Restore position only when the saved location is still on a visible display
  // (e.g. an external monitor may have been disconnected since last session).
  if (saved?.x != null && saved?.y != null && isBoundsOnVisibleDisplay(saved)) {
    windowOpts.x = saved.x
    windowOpts.y = saved.y
  }

  mainWindow = new BrowserWindow(windowOpts)
  mainWindow.setIcon(icon)

  // A generated page must not navigate its iframe to an external origin, data URL,
  // retired preview server or authenticated app endpoint to escape its CSP.
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (
      !event.isMainFrame &&
      !isWorkspacePreviewNavigationAllowed(event.url, workspacePreviewManager.getActive()?.url)
    )
      event.preventDefault()
  })

  if (CONFIG?.windowMaximized) {
    mainWindow.maximize()
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }

  if (show) {
    mainWindow.on('ready-to-show', () => {
      mainWindow?.show()
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const activePreview = workspacePreviewManager.getActive()
    if (
      activePreview &&
      isWorkspacePreviewNavigationAllowed(details.referrer?.url, activePreview.url)
    )
      return { action: 'deny' }
    openUrl(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const onBoundsChanged = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    trackNormalBounds(mainWindow)
    debounceSaveWindowBounds(mainWindow)
  }
  mainWindow.on('resize', onBoundsChanged)
  mainWindow.on('move', onBoundsChanged)
  mainWindow.on('maximize', onBoundsChanged)
  mainWindow.on('unmaximize', onBoundsChanged)

  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      if (CONFIG?.runInBackground === false) {
        isQuiting = true
        app.quit()
      } else {
        event.preventDefault()
        mainWindow?.hide()
      }
    }
  })
}

function createContentWindow(url: string, connectionId: string): BrowserWindow {
  if (contentWindow && !contentWindow.isDestroyed()) {
    contentWindow.loadURL(url)
    contentWindow.show()
    return contentWindow
  }

  contentWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false,
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? { frame: true } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition: `persist:connection-${connectionId}`
    }
  })

  session
    .fromPartition(`persist:connection-${connectionId}`)
    .setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowedPermissions = [
        'media',
        'mediaKeySystem',
        'notifications',
        'clipboard-sanitized-write'
      ]
      callback(allowedPermissions.includes(permission))
    })

  contentWindow.on('ready-to-show', () => {
    contentWindow?.show()
  })

  contentWindow.webContents.setWindowOpenHandler((details) => {
    openUrl(details.url)
    return { action: 'deny' }
  })

  contentWindow.loadURL(url)

  contentWindow.on('close', (event) => {
    if (!isQuiting) {
      if (CONFIG?.runInBackground === false) {
        isQuiting = true
        app.quit()
      } else {
        event.preventDefault()
        contentWindow?.hide()
      }
    }
  })

  contentWindow.on('closed', () => {
    contentWindow = null
  })

  return contentWindow
}


const updateTray = () => {
  if (!tray || !CONFIG) return

  const remoteItems = (CONFIG.connections || []).map((conn) => ({
    label: `${conn.id === CONFIG.defaultConnectionId ? '★ ' : ''}${conn.name}`,
    sublabel: conn.url,
    click: async () => {
      const result = await connectTo(conn)
      if (result) sendToRenderer('connection:open', result)
    }
  }))

  const localItem = isPackageInstalled('open-webui')
    ? [
        {
          label: `${CONFIG.defaultConnectionId === 'local' ? '★ ' : ''}Open WebUI (Local)`,
          sublabel: SERVER_URL || `http://127.0.0.1:${CONFIG.localServer?.port ?? 8080}`,
          click: async () => {
            const result = await connectTo(buildLocalConnection())
            if (result) sendToRenderer('connection:open', result)
          }
        }
      ]
    : []

  const allItems = [...localItem, ...remoteItems]

  const trayMenuTemplate = [
    {
      label: 'Show Open WebUI',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    ...(allItems.length > 0
      ? [{ label: 'Connections', enabled: false }, ...allItems, { type: 'separator' }]
      : []),
    ...(SERVER_STATUS === 'started' && SERVER_URL
      ? [
          {
            label: `Local: ${SERVER_URL}`,
            click: () => {
              if (SERVER_URL) clipboard.writeText(SERVER_URL)
            }
          },
          { type: 'separator' }
        ]
      : []),
    {
      label: 'Quit Open WebUI',
      accelerator: 'CommandOrControl+Q',
      click: async () => {
        await stopServerHandler()
        isQuiting = true
        app.quit()
      }
    }
  ]

  const trayMenu = Menu.buildFromTemplate(trayMenuTemplate)
  tray?.setContextMenu(trayMenu)
}


// Local is a virtual connection, available when open-webui is installed; only remote entries are persisted.
const buildLocalConnection = (): Connection => {
  const port = CONFIG?.localServer?.port ?? 8080
  return {
    id: 'local',
    name: 'Open WebUI',
    type: 'local',
    url: SERVER_URL || `http://127.0.0.1:${port}`
  }
}

// The reserved local id resolves from current runtime configuration, not the saved connection list.
const getDefaultConnection = async (): Promise<Connection | null> => {
  const config = await getConfig()
  if (!config.defaultConnectionId) return null
  if (config.defaultConnectionId === 'local') return buildLocalConnection()
  return config.connections.find((c) => c.id === config.defaultConnectionId) ?? null
}

const resolveConnectionUrl = (conn: Connection): string => {
  let url = conn.url
  if (conn.type === 'local' && SERVER_URL) url = SERVER_URL
  if (url.startsWith('http://0.0.0.0')) url = url.replace('http://0.0.0.0', 'http://localhost')
  return url
}

const connectTo = async (connection: Connection) => {
  let url = connection.url

  if (connection.type === 'local') {
    if (SERVER_STATUS !== 'started') {
      const started = await startServerHandler()
      if (!started) return null
    }
    url = SERVER_URL || connection.url

    // Process spawn precedes HTTP readiness, especially during first-run initialization.
    if (!SERVER_REACHABLE) {
      const maxWait = 120_000
      const poll = 2_000
      const t0 = Date.now()
      while (!SERVER_REACHABLE && Date.now() - t0 < maxWait) {
        await new Promise((r) => setTimeout(r, poll))
      }
      if (!SERVER_REACHABLE) {
        log.warn('connectTo: server did not become reachable within timeout')
        return null
      }
    }
  }

  if (url.startsWith('http://0.0.0.0')) {
    url = url.replace('http://0.0.0.0', 'http://localhost')
  }

  return { url, connectionId: connection.id }
}


// Replaced when the renderer reconnects its PTY port.
let activePtyDataDisposable: { dispose: () => void } | null = null

const startServerHandler = async (): Promise<boolean> => {
  if (SERVER_STATUS === 'starting' || SERVER_STATUS === 'started') {
    log.info('[server] Already running or starting, skipping duplicate start')
    return true
  }
  await stopServerHandler()
  SERVER_STATUS = 'starting'
  sendToRenderer('status:server', SERVER_STATUS)

  try {
    CONFIG = await getConfig()

    // Each desktop release carries an explicit, compatibility-tested backend.
    const runtimeUpgrade = runtimeUpgradeVersion(
      getPackageVersion('open-webui'),
      runtimeVersions.openWebUI,
      CONFIG?.localServer
    )
    if (runtimeUpgrade && isPackageInstalled('open-webui')) {
      try {
        log.info(`[server] Updating open-webui to release-tested ${runtimeUpgrade}…`)
        sendToRenderer('status:install', 'Updating Open WebUI…')
        await backupOpenWebUIDatabase()
        await installPackage('open-webui', runtimeUpgrade, (status: string) => {
          sendToRenderer('status:install', status)
        })
        sendToRenderer('status:install', '')
        log.info('[server] Auto-update complete')
      } catch (e) {
        // Non-fatal — start the existing version if upgrade fails
        log.warn('[server] Auto-update failed, starting existing version:', e)
        sendToRenderer('status:install', '')
      }
    }

    const { url, pid } = await startServer(
      CONFIG?.localServer?.serveOnLocalNetwork ?? false,
      CONFIG?.localServer?.port ?? null
    )
    SERVER_URL = url
    SERVER_PID = pid
    SERVER_STATUS = 'started'
    log.info('Server started:', SERVER_URL, SERVER_PID)
    sendToRenderer('status:server', SERVER_STATUS)

    // Auto-push PTY port so an already-open log panel picks up live output
    connectPtyPort(pid)
    updateTray()

    // Connectors and workspaces can only be registered once the server answers.
    scheduleOpenWebUISync()

    checkUrlAndOpen(SERVER_URL, async () => {
      SERVER_REACHABLE = true
      sendToRenderer('server:ready', { url: SERVER_URL })
      updateTray()
    })

    return true
  } catch (error) {
    log.error('Failed to start server:', error)
    SERVER_STATUS = 'failed'
    sendToRenderer('status:server', SERVER_STATUS)
    sendToRenderer('error', { message: `Failed to start server: ${error?.message}` })
    updateTray()
    return false
  }
}

// Active PTY data listeners — one per PID, replaced on each pty:connect for that PID
const activePtyDisposables: Map<number, { dispose: () => void }> = new Map()

/** One transferable MessagePort per PID carries PTY output and interactive input. */
const connectPtyPort = (pid?: number): void => {
  const targetPid = pid ?? SERVER_PID
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  if (!targetPid) {
    if (SERVER_STATUS === 'starting') {
      log.info('pty:connect — server is starting, no PID yet')
    } else {
      log.info('pty:connect — no active server')
      port1.postMessage({ type: 'output', data: '[No active server process]\r\n' })
    }
    mainWindow.webContents.postMessage('pty:port', { pid: 0 }, [port2])
    return
  }

  activePtyDisposables.get(targetPid)?.dispose()
  activePtyDisposables.delete(targetPid)

  const ptyProcess = getServerPty(targetPid)
  log.info(`pty:connect — PID ${targetPid}, pty exists: ${!!ptyProcess}`)

  const buffer = getServerLog(targetPid)
  if (buffer?.length) {
    for (const chunk of buffer) {
      port1.postMessage({ type: 'output', data: chunk })
    }
  }

  if (ptyProcess) {
    const disposable = ptyProcess.onData((data: string) => {
      port1.postMessage({ type: 'output', data })
    })
    activePtyDisposables.set(targetPid, disposable)

    port1.on('message', (event) => {
      const msg = event.data
      if (msg.type === 'input') {
        ptyProcess.write(msg.data)
      } else if (msg.type === 'resize') {
        ptyProcess.resize(msg.cols, msg.rows)
      }
    })
    port1.start()
  }

  mainWindow.webContents.postMessage('pty:port', { pid: targetPid }, [port2])
}

let activeOpenTerminalDisposable: { dispose: () => void } | null = null

const connectOpenTerminalPtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  const otPty = getOpenTerminalPty()
  if (!otPty) {
    port1.postMessage({ type: 'output', data: '[Open Terminal is not running]\r\n' })
    mainWindow.webContents.postMessage('open-terminal:pty:port', null, [port2])
    return
  }

  activeOpenTerminalDisposable?.dispose()

  const buffer = getOpenTerminalLog()
  for (const chunk of buffer) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  const disposable = otPty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })
  activeOpenTerminalDisposable = disposable

  port1.start()
  mainWindow.webContents.postMessage('open-terminal:pty:port', null, [port2])
}

let activeLlamaCppDisposable: { dispose: () => void } | null = null

const connectLlamaCppPtyPort = (): void => {
  if (!mainWindow) return

  const { port1, port2 } = new MessageChannelMain()

  const lsPty = getLlamaCppPty()
  if (!lsPty) {
    port1.postMessage({ type: 'output', data: '[llamacpp is not running]\r\n' })
    mainWindow.webContents.postMessage('llamacpp:pty:port', null, [port2])
    return
  }

  activeLlamaCppDisposable?.dispose()

  const buffer = getLlamaCppLog()
  for (const chunk of buffer) {
    port1.postMessage({ type: 'output', data: chunk })
  }

  const disposable = lsPty.onData((data: string) => {
    port1.postMessage({ type: 'output', data })
  })
  activeLlamaCppDisposable = disposable

  port1.start()
  mainWindow.webContents.postMessage('llamacpp:pty:port', null, [port2])
}

const stopServerHandler = async (): Promise<boolean> => {
  try {
    await stopAllServers()
    if (SERVER_STATUS) {
      SERVER_STATUS = 'stopped'
      updateTray()
    }
    SERVER_REACHABLE = false
    SERVER_URL = null
    sendToRenderer('status:server', SERVER_STATUS)
    return true
  } catch (error) {
    log.error('Failed to stop server:', error)
    return false
  }
}

const resetAppHandler = async () => {
  try {
    await stopServerHandler()
    SERVER_STATUS = null
    try {
      await stopOpenTerminal()
      sendToRenderer('status:open-terminal', null)
    } catch (e) {
      log.warn('Failed to stop Open Terminal during reset:', e)
    }
    try {
      await uninstallLlamaCpp()
      sendToRenderer('status:llamacpp', null)
    } catch (e) {
      log.warn('Failed to uninstall llama.cpp during reset:', e)
    }
    // Remove GPU crash marker so sandbox is re-tested on next launch
    try {
      if (existsSync(gpuCrashMarkerPath)) {
        unlinkSync(gpuCrashMarkerPath)
        log.info('GPU crash marker removed during reset')
      }
    } catch (e) {
      log.warn('Failed to remove GPU crash marker during reset:', e)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await resetApp()
    CONFIG = await getConfig()
    new Notification({ title: 'Open WebUI', body: 'Application has been reset.' }).show()
  } catch (error) {
    log.error('Failed to reset:', error)
    new Notification({ title: 'Open WebUI', body: `Reset failed: ${error.message}` }).show()
  }
}


const sendToRenderer = (type: string, data?: any) => {
  mainWindow?.webContents.send('main:data', { type, data })
}


const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.setAboutPanelOptions({
    applicationName: FORK_NAME,
    iconPath: icon,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    website: FORK_REPOSITORY,
    copyright: `© ${new Date().getFullYear()} Open WebUI`
  })

  app.whenReady().then(async () => {
    CONFIG = await getConfig()
    loadSpotlightPosition()
    log.info('Configuration loaded')

    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon)
    }
    electronApp.setAppUserModelId(FORK_APP_ID)

    // Register through the main process so synchronization does not require an existing webview.
    configureOpenWebUISync({
      resolveBaseUrl: () =>
        SERVER_STATUS === 'started' && SERVER_URL
          ? SERVER_URL.replace('http://0.0.0.0', 'http://localhost')
          : null,
      resolveToken: () => AUTH_TOKEN,
      listToolTargets: () => getManagedServicesManager()?.getToolTargets() ?? [],
      onResult: (result) => sendToRenderer('open-webui:sync', result)
    })

    // The repository view reuses the connector's token; it never asks for one.
    configureGithubFs(
      () => getManagedServicesManager()?.getGithubAccessToken() ?? null,
      () => getManagedServicesManager()?.getGithubCliRequest() ?? null
    )

    void initializeManagedServices().then(() => {
      getManagedServicesManager()?.onChange(() => scheduleOpenWebUISync())
      scheduleOpenWebUISync()
    })

    // Persist fatal GPU failures and relaunch with the sandbox disabled.
    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'GPU') {
        log.error(`GPU process gone: reason=${details.reason}, exitCode=${details.exitCode}`)

        if (
          details.reason === 'crashed' ||
          details.reason === 'launch-failed' ||
          details.reason === 'abnormal-exit'
        ) {
          if (!gpuSandboxDisabled) {
            log.info('Writing GPU crash marker and relaunching with --disable-gpu-sandbox')
            try {
              writeFileSync(gpuCrashMarkerPath, new Date().toISOString(), 'utf-8')
            } catch (e) {
              log.warn('Failed to write GPU crash marker:', e)
            }
            app.relaunch({ args: [...process.argv.slice(1), '--disable-gpu-sandbox'] })
            app.exit(0)
          }
        }
      }
    })

    if (gpuSandboxDisabled) {
      log.info('Running with GPU sandbox disabled (marker file present)')
    }

    // Self-hosted server compatibility disables certificate verification; this is not certificate pinning.
    app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
      log.warn(
        `Certificate error: ${error} for ${url} ` +
          `(subject: ${certificate.subjectName}, issuer: ${certificate.issuerName})`
      )
      event.preventDefault()
      callback(true)
    })

    // Trust all certs on the default session (used by net.fetch() in
    // validateRemoteUrl / checkUrlAndOpen).
    session.defaultSession.setCertificateVerifyProc((_request, callback) => {
      callback(0) // 0 = verified/trusted
    })

    // Webview partitions need the same certificate policy as the default session.
    app.on('session-created', (newSession) => {
      newSession.setCertificateVerifyProc((_request, callback) => {
        callback(0)
      })

      // Grant media / notification permissions for webview partition sessions
      // so that auth flows, media capture, and notifications work correctly.
      newSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = [
          'media',
          'mediaKeySystem',
          'notifications',
          'clipboard-read',
          'clipboard-sanitized-write'
        ]
        callback(allowed.includes(permission))
      })
    })

    // Opaque sandboxed frames omit Referer for CSS/modules. Supply only the
    // preview's own capability, only to its current origin and trusted renderer.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders =
        mainWindow && details.webContentsId === mainWindow.webContents.id
          ? getWorkspacePreviewRequestHeaders(
              details.url,
              workspacePreviewManager.getActive()?.url,
              details.requestHeaders
            )
          : details.requestHeaders
      callback({ requestHeaders })
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)

      // Auto-reload when the renderer process dies so the user doesn't
      // see a permanent blank/grey screen.
      window.webContents.on('render-process-gone', (_event, details) => {
        log.error(`Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`)
        if (details.reason !== 'clean-exit') {
          window.webContents.reload()
        }
      })
    })

    // Log guest crashes and keep external links from replacing the embedded chat.
    app.on('web-contents-created', (_event, contents) => {
      contents.on('render-process-gone', (_e, details) => {
        if (details.reason !== 'clean-exit') {
          log.error(
            `WebContents render-process-gone: type=${contents.getType()}, ` +
              `reason=${details.reason}, exitCode=${details.exitCode}`
          )
        }
      })

      if (contents.getType() === 'webview') {
        contents.setWindowOpenHandler(({ url }) => {
          openUrl(url)
          return { action: 'deny' }
        })

        // Cross-origin navigation belongs in the external browser, not the embedded chat.
        contents.on('will-navigate', (event, url) => {
          try {
            const currentOrigin = new URL(contents.getURL()).origin
            const targetOrigin = new URL(url).origin
            if (targetOrigin !== currentOrigin) {
              event.preventDefault()
              openUrl(url)
            }
          } catch {
            // Malformed URL — let it through so Chromium can handle/reject it
          }
        })

        // Webview guests need an explicit native menu for editing, spell-check and link actions.
        contents.on('context-menu', (_event, params) => {
          const menuItems: Electron.MenuItemConstructorOptions[] = []

          if (params.misspelledWord && params.dictionarySuggestions?.length) {
            for (const suggestion of params.dictionarySuggestions) {
              menuItems.push({
                label: suggestion,
                click: () => contents.replaceMisspelling(suggestion)
              })
            }
            menuItems.push({ type: 'separator' })
          }

          if (params.linkURL) {
            menuItems.push({
              label: 'Open Link in Browser',
              click: () => openUrl(params.linkURL)
            })
            menuItems.push({
              label: 'Copy Link',
              click: () => clipboard.writeText(params.linkURL)
            })
            menuItems.push({ type: 'separator' })
          }

          if (params.isEditable) {
            menuItems.push(
              { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
              { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
              { type: 'separator' },
              { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
              { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
              { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
              { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }
            )
          } else if (params.selectionText) {
            menuItems.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy })
          }

          if (menuItems.length > 0) {
            Menu.buildFromTemplate(menuItems).popup()
          }
        })
      }
    })


    ipcMain.handle('get:version', () => app.getVersion())

    ipcMain.handle('app:info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      username: require('os').userInfo().username,
      gpuSandboxDisabled
    }))

    ipcMain.handle('app:contentPreloadPath', () => {
      return `file://${join(__dirname, '../preload/content-preload.js')}`
    })

    ipcMain.handle('app:defaultDataPath', () => {
      return join(getUserDataPath(), 'data')
    })

    ipcMain.handle('app:installDir', () => {
      return getInstallDir()
    })

    ipcMain.handle('system:diskSpace', async () => {
      try {
        const stats = await statfs(getUserDataPath())
        return { free: stats.bavail * stats.bsize }
      } catch (error) {
        log.error('Failed to check disk space:', error)
        return { free: -1 }
      }
    })

    ipcMain.handle('get:config', () => getConfig())
    ipcMain.handle('set:config', async (_event, config) => {
      await setConfig(config)
      CONFIG = await getConfig()
      updateTray()
      voiceInputRecording = false
      registerShortcuts(
        CONFIG.globalShortcut,
        CONFIG.spotlightShortcut,
        CONFIG.voiceInputShortcut,
        CONFIG.callShortcut
      )
    })

    ipcMain.handle('install:python', async () => {
      try {
        sendToRenderer('status:install', 'Downloading Python…')
        const res = await installPython(undefined, (status: string) => {
          sendToRenderer('status:install', status)
        })
        sendToRenderer('status:python', res)
        return res
      } catch (error) {
        sendToRenderer('status:python', false)
        sendToRenderer('error', {
          message:
            error?.message ??
            'Python installation failed. Please check your internet connection and try again.'
        })
        return false
      }
    })

    ipcMain.handle('status:python', async () => {
      return (await isPythonInstalled()) && (await isUvInstalled())
    })

    ipcMain.handle('install:package', async () => {
      try {
        CONFIG = await getConfig()
        const owuiVersion = CONFIG?.localServer?.version || runtimeVersions.openWebUI
        const otVersion = CONFIG?.openTerminal?.version || runtimeVersions.openTerminal

        sendToRenderer('status:install', 'Installing Open WebUI…')
        await installPackage('open-webui', owuiVersion, (status: string) => {
          sendToRenderer('status:install', status)
        })
        sendToRenderer('status:install', 'Installing Open Terminal…')
        await installPackage('open-terminal', otVersion, (status: string) => {
          sendToRenderer('status:install', status)
        }).catch((e) => log.warn('open-terminal install failed (non-fatal):', e))
        sendToRenderer('status:package', true)
        sendToRenderer('packages:changed', {
          'open-webui': isPackageInstalled('open-webui')
        })
        const cfg = await getConfig()
        if (!cfg.defaultConnectionId) {
          cfg.defaultConnectionId = 'local'
          await setConfig(cfg)
          CONFIG = cfg
        }
        updateTray()
        return true
      } catch (error) {
        sendToRenderer('status:package', false)
        sendToRenderer('error', {
          message:
            error?.message ??
            'Package installation failed. Please check your internet connection and try again.'
        })
        return false
      }
    })

    ipcMain.handle('status:package', async () => isPackageInstalled('open-webui'))

    ipcMain.handle('server:start', () => startServerHandler())
    ipcMain.handle('server:stop', () => stopServerHandler())
    ipcMain.handle('server:restart', async () => {
      await stopServerHandler()
      return startServerHandler()
    })
    ipcMain.handle('server:logs', () => (SERVER_PID ? getServerLog(SERVER_PID) : []))
    ipcMain.handle('server:logs:clear', () => clearAllServerLogs())

    ipcMain.handle('pty:list', () => getServerPIDs())
    ipcMain.handle('pty:connect', (_event, pid?: number) => connectPtyPort(pid))
    ipcMain.handle('server:info', () => ({
      url: SERVER_URL,
      status: SERVER_STATUS,
      pid: SERVER_PID,
      reachable: SERVER_REACHABLE
    }))

    // Connections (remote only — local is virtual)
    ipcMain.handle('connections:list', async () => {
      const config = await getConfig()
      return config.connections
    })

    ipcMain.handle('connections:add', async (_event, connection: Connection) => {
      const config = await getConfig()
      config.connections.push(connection)
      if (!config.defaultConnectionId) {
        config.defaultConnectionId = connection.id
      }
      await setConfig(config)
      CONFIG = config
      updateTray()
      sendToRenderer('connections:changed', config.connections)
      return config.connections
    })

    ipcMain.handle('connections:remove', async (_event, id: string) => {
      const config = await getConfig()
      config.connections = config.connections.filter((c) => c.id !== id)
      if (config.defaultConnectionId === id) {
        config.defaultConnectionId = config.connections[0]?.id || 'local'
      }
      await setConfig(config)
      CONFIG = config
      updateTray()
      sendToRenderer('connections:changed', config.connections)
      return config.connections
    })

    ipcMain.handle(
      'connections:update',
      async (_event, id: string, updates: Partial<Connection>) => {
        const config = await getConfig()
        const idx = config.connections.findIndex((c) => c.id === id)
        if (idx !== -1) {
          config.connections[idx] = { ...config.connections[idx], ...updates }
          await setConfig(config)
          CONFIG = config
          updateTray()
          sendToRenderer('connections:changed', config.connections)
        }
        return config.connections
      }
    )

    ipcMain.handle('connections:setDefault', async (_event, id: string) => {
      const config = await getConfig()
      config.defaultConnectionId = id
      await setConfig(config)
      CONFIG = config
      updateTray()
    })

    ipcMain.handle('connections:connect', async (_event, id: string) => {
      if (id === 'local') {
        return await connectTo(buildLocalConnection())
      }
      const config = await getConfig()
      const conn = config.connections.find((c) => c.id === id)
      if (conn) {
        return await connectTo(conn)
      }
      return null
    })

    ipcMain.handle('validate:url', async (_event, url: string) => {
      return await validateRemoteUrl(url)
    })

    ipcMain.handle('updater:check', () => checkForUpdates())
    ipcMain.handle('updater:download', () => downloadUpdate())
    ipcMain.handle('updater:install', () => installUpdate())

    ipcMain.handle('app:changelog', async () => {
      try {
        const changelogPath = app.isPackaged
          ? join(process.resourcesPath, 'CHANGELOG.md')
          : join(app.getAppPath(), 'CHANGELOG.md')
        return await readFile(changelogPath, 'utf-8')
      } catch {
        return null
      }
    })

    ipcMain.handle('app:setAuthToken', (_event, token: string) => {
      const isNew = AUTH_TOKEN !== (token || null)
      AUTH_TOKEN = token || null
      log.info('Auth token updated from webview')
      // A fresh sign-in is usually what unblocks a deferred registration.
      if (isNew && AUTH_TOKEN) scheduleOpenWebUISync()
    })

    ipcMain.handle('app:reset', () => resetAppHandler())

    ipcMain.handle('spotlight:submit', async (_event, query: string, images?: string[]) => {
      const conn = await getDefaultConnection()
      if (!conn) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }

      const url = resolveConnectionUrl(conn)

      const files = images?.map((dataUrl, i) => ({
        name: `screenshot-${Date.now()}-${i + 1}.png`,
        mimeType: 'image/png',
        dataUrl
      }))

      sendToRenderer('query', { query, connectionId: conn.id, url, files })

      spotlightWindow?.hide()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    ipcMain.handle('spotlight:close', () => {
      spotlightWindow?.hide()
    })

    ipcMain.handle('spotlight:savePosition', async (_event, offset: { x: number; y: number }) => {
      spotlightBarOffset = offset
      setConfig({ spotlightPosition: offset }).catch((err) =>
        log.warn('Failed to persist spotlight bar position:', err)
      )
    })

    // Capture a region of the screen (called from Spotlight renderer after drag)
    ipcMain.handle(
      'spotlight:captureRegion',
      async (_event, rect: { x: number; y: number; width: number; height: number }) => {
        try {
          if (process.platform === 'darwin') {
            const status = systemPreferences.getMediaAccessStatus('screen')
            if (status !== 'granted') {
              log.warn(`spotlight:captureRegion — screen recording permission: ${status}`)
              new Notification({
                title: 'Screen Recording Permission Required',
                body: 'Open WebUI needs Screen Recording access to capture screenshots. Please enable it in System Settings → Privacy & Security → Screen Recording, then restart the app.'
              }).show()
              shell
                .openExternal(
                  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
                )
                .catch(() => {})
              return 'no-permission'
            }
          }

          // Make spotlight invisible (but don't hide it — hiding triggers macOS
          // window activation which brings up the main window behind it)
          spotlightWindow?.setOpacity(0)
          // Small delay to let the window fully disappear before capture
          await new Promise((r) => setTimeout(r, 150))

          const { screen } = require('electron')
          const cursorPoint = screen.getCursorScreenPoint()
          const display = screen.getDisplayNearestPoint(cursorPoint)
          const scaleFactor = display.scaleFactor || 1

          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
              width: Math.round(display.bounds.width * scaleFactor),
              height: Math.round(display.bounds.height * scaleFactor)
            }
          })

          const source = sources.find((s) => s.display_id === String(display.id)) || sources[0]
          if (!source) {
            spotlightWindow?.setOpacity(1)
            return null
          }

          const fullImage = source.thumbnail
          // Validate thumbnail is not empty (can happen without permission)
          if (fullImage.isEmpty()) {
            log.warn('spotlight:captureRegion — captured thumbnail is empty (likely no permission)')
            spotlightWindow?.setOpacity(1)
            return null
          }

          const cropped = fullImage.crop({
            x: Math.round(rect.x * scaleFactor),
            y: Math.round(rect.y * scaleFactor),
            width: Math.round(rect.width * scaleFactor),
            height: Math.round(rect.height * scaleFactor)
          })

          if (spotlightWindow && !spotlightWindow.isDestroyed()) {
            spotlightWindow.setOpacity(1)
          }

          return cropped.toDataURL()
        } catch (err) {
          log.error('spotlight:captureRegion failed:', err)
          spotlightWindow?.setOpacity(1)
          return null
        }
      }
    )


    ipcMain.handle('voiceInput:micPermission', async () => {
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone')
        if (status !== 'granted') {
          const granted = await systemPreferences.askForMediaAccess('microphone')
          return granted ? 'granted' : 'denied'
        }
        return 'granted'
      }
      return 'granted' // Windows/Linux don't need explicit permission
    })

    ipcMain.handle(
      'voiceInput:transcribe',
      async (_event, audioBuffer: ArrayBuffer, rendererToken?: string) => {
        try {
          const conn = await getDefaultConnection()
          if (!conn)
            throw new Error('No connection configured. Set up a connection in Settings first.')

          const url = resolveConnectionUrl(conn)

          // Use stored auth token (relayed from webview), fall back to renderer-provided or contentWindow
          let token = AUTH_TOKEN || rendererToken || ''
          if (!token) {
            try {
              const { webContents: wc } = require('electron')
              const allContents = wc.getAllWebContents()
              for (const contents of allContents) {
                try {
                  if (contents.getType() === 'webview' && !contents.isDestroyed()) {
                    const t = await contents.executeJavaScript(
                      `localStorage.getItem('token') || ''`
                    )
                    if (t) {
                      token = t
                      break
                    }
                  }
                } catch {
                  // Skip inaccessible webContents
                }
              }
            } catch {
              log.warn('voiceInput:transcribe — could not extract token from webviews')
            }
          }

          if (!token) {
            throw new Error(
              'Not authenticated. Open a connection and sign in before using voice input.'
            )
          }

          const boundary = '----VoiceInput' + Date.now()
          const buffer = Buffer.from(audioBuffer)
          const filename = `recording-${Date.now()}.wav`

          const header = [
            `--${boundary}`,
            `Content-Disposition: form-data; name="file"; filename="${filename}"`,
            `Content-Type: audio/wav`,
            '',
            ''
          ].join('\r\n')

          const footer = `\r\n--${boundary}--\r\n`
          const headerBuf = Buffer.from(header, 'utf-8')
          const footerBuf = Buffer.from(footer, 'utf-8')
          const body = Buffer.concat([headerBuf, buffer, footerBuf])

          const response = await fetch(`${url}/api/v1/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body
          })

          if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(
              `Transcription failed (HTTP ${response.status}). ${text || 'Check that your server has Speech-to-Text configured.'}`
            )
          }

          const result = await response.json()
          return result
        } catch (error: any) {
          log.error('voiceInput:transcribe failed:', error)
          new Notification({
            title: 'Voice Input Failed',
            body: error?.message || 'Transcription failed. Check logs for details.'
          }).show()
          throw error
        }
      }
    )

    ipcMain.handle('voiceInput:done', async (_event, text: string) => {
      voiceInputRecording = false
      playChime(false)
      if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
        voiceInputWindow.hide()
      }

      if (!text?.trim()) return

      const conn = await getDefaultConnection()
      if (!conn) {
        mainWindow?.show()
        mainWindow?.focus()
        return
      }

      const url = resolveConnectionUrl(conn)
      sendToRenderer('query', { query: text.trim(), connectionId: conn.id, url })

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })

    ipcMain.handle('voiceInput:close', () => {
      voiceInputRecording = false
      playChime(false)
      if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
        voiceInputWindow.hide()
      }
    })

    ipcMain.handle('voiceInput:error', (_event, message: string) => {
      log.warn('Voice input error:', message)
      voiceInputRecording = false
      new Notification({
        title: 'Voice Input Error',
        body: message || 'An unknown error occurred with voice input.'
      }).show()
    })

    // Register terminals through the admin API: the page helper creates id-less entries that its picker hides.
    ipcMain.handle('open-terminal:start', async () => {
      try {
        sendToRenderer('status:open-terminal', 'starting')
        const result = await startOpenTerminal((status) => {
          sendToRenderer('status:open-terminal-setup', status)
        })
        sendToRenderer('status:open-terminal', 'started')
        sendToRenderer('open-terminal:ready', result)
        scheduleOpenWebUISync()
        return result
      } catch (error) {
        log.error('Failed to start Open Terminal:', error)
        sendToRenderer('status:open-terminal', 'failed')
        sendToRenderer('error', { message: `Open Terminal failed: ${error?.message}` })
        throw new Error(`Open Terminal failed: ${error?.message ?? error}`)
      }
    })

    ipcMain.handle('open-terminal:stop', async () => {
      try {
        await workspacePreview.closeAll()
        await stopOpenTerminal()
        sendToRenderer('status:open-terminal', 'stopped')
        scheduleOpenWebUISync()
        return true
      } catch (error) {
        log.error('Failed to stop Open Terminal:', error)
        return false
      }
    })

    ipcMain.handle('open-terminal:sync', async () => {
      const result = await syncOpenWebUI()
      return result.status === 'synced' || result.status === 'unchanged'
    })

    ipcMain.handle('open-terminal:info', () => getOpenTerminalInfo())
    ipcMain.handle('open-terminal:status', () => isPackageInstalled('open-terminal'))
    ipcMain.handle('open-terminal:pty:connect', () => connectOpenTerminalPtyPort())

    ipcMain.handle('open-webui:sync', () => syncOpenWebUI())

    ipcMain.handle('workspace:preview:inspect', workspacePreview.inspect)
    ipcMain.handle('workspace:preview:open', workspacePreview.open)
    ipcMain.handle('workspace:preview:close', workspacePreview.close)
    ipcMain.handle('workspace:preview:get-active', workspacePreview.getActive)

    // Guest handlers return {ok} so failures become actionable chip messages, not unhandled rejections.
    const chipError = (cause: unknown): { ok: false; error: string } => ({
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause)
    })
    const syncWorkspaceRegistration = async (): Promise<void> => {
      let result = await syncOpenWebUI({ refreshTerminals: true })
      for (const delay of [250, 500, 1_000, 2_000]) {
        if (result.status === 'synced' || result.status === 'unchanged') return
        if (
          result.status === 'skipped' &&
          result.reason !== 'not-signed-in' &&
          result.reason !== 'server-not-running'
        )
          break
        await new Promise((resolve) => setTimeout(resolve, delay))
        result = await syncOpenWebUI({ refreshTerminals: true })
      }
      throw new Error(`Workspace registration failed (${result.reason ?? result.status}).`)
    }

    ipcMain.handle('workspace:chip:choose-folder', async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: 'Choose a workspace folder'
        })
        if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'canceled' }
        const folder = result.filePaths[0]
        return { ok: true, path: folder, name: path.basename(folder) || folder }
      } catch (cause) {
        return chipError(cause)
      }
    })

    ipcMain.handle('workspace:chip:recent', async () => {
      try {
        return { ok: true, workspaces: await listWorkspaces() }
      } catch (cause) {
        return chipError(cause)
      }
    })

    // Local workspace selections outlive the Open Terminal process in the
    // embedded page's localStorage. Restore only the workspace of the current
    // conversation after an app restart; do not reopen every recent folder.
    ipcMain.handle(
      'workspace:chip:ensure',
      async (_event, request: { path?: string; terminalId?: string }) => {
        try {
          const requestedId =
            typeof request?.terminalId === 'string' ? request.terminalId.trim() : ''
          const recent = await listWorkspaces()
          const workspacePath =
            recent.find((entry) => workspaceTerminalId(entry.path) === requestedId)?.path || ''
          if (!workspacePath)
            throw new Error('The selected workspace folder is no longer available.')

          await workspacePreview.closeAll()
          const terminal = await startWorkspaceTerminal(workspacePath)
          await setWorkspaceActive(workspacePath, true)
          sendToRenderer('status:open-terminal', 'started')
          sendToRenderer('open-terminal:ready', getOpenTerminalInfo())
          await syncWorkspaceRegistration()
          return {
            ok: true,
            path: workspacePath,
            terminal: { id: terminal.id, name: path.basename(workspacePath) || workspacePath }
          }
        } catch (cause) {
          return chipError(cause)
        }
      }
    )

    ipcMain.handle('workspace:chip:repos', async () => {
      try {
        const token =
          getManagedServicesManager()?.getGithubCliRequest() ??
          getManagedServicesManager()?.getGithubAccessToken()
        if (!token) {
          return {
            ok: false,
            error: 'Add the GitHub connector under Settings → Services & Connectors first.'
          }
        }
        return { ok: true, repos: await listGithubRepositories(token) }
      } catch (cause) {
        return chipError(cause)
      }
    })

    // Release unreferenced idle terminals so they do not keep workspace directory handles open.
    let workspaceKeepRevision = 0
    const workspaceRegistrationIds = (): string[] => [
      ...listWorkspaceTerminals()
        .filter((terminal) => terminal.status === 'started')
        .map((terminal) => terminal.id),
      ...listGithubMounts().map((mount) => mount.id)
    ]
    ipcMain.handle('workspace:chip:keep-alive', async (_event, keep: string[]) => {
      const revision = ++workspaceKeepRevision
      try {
        const wanted = new Set(
          Array.isArray(keep) ? keep.filter((id) => typeof id === 'string') : []
        )
        // Manual Start and autostart both own their service for this session.
        // Autostart is only a preference for the next launch, not an idle lease.
        const previousMounts = listGithubMounts()
        const unmounted = unmountGithubRepos(wanted)
        if (unmounted) {
          for (const mount of previousMounts) {
            if (revision !== workspaceKeepRevision) break
            if (!listGithubMounts().some((entry) => entry.id === mount.id))
              await workspacePreview.releaseTerminal(mount.id)
          }
        }
        const stopped: string[] = []
        for (const terminal of listWorkspaceTerminals()) {
          if (revision !== workspaceKeepRevision) break
          if (wanted.has(terminal.id) || isOpenTerminalService(terminal.id)) continue
          if (terminal.status === 'starting') continue
          const terminated = terminal.status === 'stopped' || terminal.status === 'failed'
          if (
            !terminated &&
            (!terminal.url ||
              !terminal.apiKey ||
              !(await canReleaseWorkspaceTerminal(
                (route) =>
                  fetch(terminal.url + route, {
                    headers: { Authorization: 'Bearer ' + terminal.apiKey },
                    signal: AbortSignal.timeout(5000)
                  }),
                () => isOpenTerminalService(terminal.id) || revision !== workspaceKeepRevision
              )))
          )
            continue
          // A newer selection may have arrived while the idle probe was pending.
          if (revision !== workspaceKeepRevision) break
          if (isOpenTerminalService(terminal.id)) continue
          await workspacePreview.releaseTerminal(terminal.id)
          if (revision !== workspaceKeepRevision) break
          if (isOpenTerminalService(terminal.id)) continue
          await stopWorkspaceTerminal(terminal.cwd)
          await setWorkspaceActive(terminal.cwd, false)
          stopped.push(terminal.cwd)
        }
        if (stopped.length || unmounted) {
          log.info(
            `Released ${stopped.length} folder(s) and ${unmounted} repository mount(s)` +
              (stopped.length ? `: ${stopped.join(', ')}` : '')
          )
          sendToRenderer('open-terminal:ready', getOpenTerminalInfo())
          if (!listWorkspaceTerminals().length) sendToRenderer('status:open-terminal', 'stopped')
          await syncOpenWebUI()
        }
        return { ok: true, stopped: stopped.length, ids: workspaceRegistrationIds() }
      } catch (cause) {
        return chipError(cause)
      }
    })

    // A cloud workspace needs no checkout: its scoped file tools read and commit
    // to the selected repository and branch, while the terminal entry serves FileNav.
    ipcMain.handle(
      'workspace:chip:cloud',
      async (_event, repo: { repoFullName: string; branch: string }) => {
        try {
          if (!repo?.repoFullName || !repo?.branch) throw new Error('A repository is required')
          if (
            !getManagedServicesManager()?.getGithubCliRequest() &&
            !getManagedServicesManager()?.getGithubAccessToken()
          ) {
            throw new Error(
              'Add the GitHub connector under Settings → Services & Connectors first.'
            )
          }
          await workspacePreview.closeAll()
          const mount = await mountGithubRepo({
            repoFullName: String(repo.repoFullName),
            branch: String(repo.branch)
          })
          await syncWorkspaceRegistration()
          return { ok: true, terminal: { id: mount.id, name: mount.name } }
        } catch (cause) {
          return chipError(cause)
        }
      }
    )

    ipcMain.handle('workspace:chip:open', async (_event, workspacePath: string) => {
      try {
        if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
          throw new Error('A workspace folder is required')
        }
        await workspacePreview.closeAll()
        const terminal = await startWorkspaceTerminal(workspacePath)
        await rememberWorkspace(workspacePath)
        await setWorkspaceActive(workspacePath, true)
        sendToRenderer('status:open-terminal', 'started')
        sendToRenderer('open-terminal:ready', getOpenTerminalInfo())

        // The chat can only address the terminal once Open WebUI knows it.
        await syncWorkspaceRegistration()
        return {
          ok: true,
          terminal: { id: terminal.id, name: path.basename(terminal.cwd) || terminal.cwd }
        }
      } catch (cause) {
        return chipError(cause)
      }
    })

    ipcMain.handle('llamacpp:setup', async () => {
      try {
        sendToRenderer('status:llamacpp', 'setting-up')
        const binary = await setupLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
        })
        sendToRenderer('status:llamacpp', 'ready')
        return binary
      } catch (error) {
        log.error('Failed to setup llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        sendToRenderer('error', { message: `llamacpp setup failed: ${error?.message}` })
        return null
      }
    })

    ipcMain.handle('llamacpp:start', async () => {
      try {
        sendToRenderer('status:llamacpp', 'starting')
        const result = await startLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
        })
        sendToRenderer('status:llamacpp', 'started')
        sendToRenderer('llamacpp:ready', result)
        if (result.url) {
          sendToRenderer('connections:openai', {
            action: 'add',
            url: `${result.url}/v1`,
            config: { provider: 'llama.cpp', connection_type: 'local' }
          })
          setTimeout(() => sendToRenderer('models:refresh'), 1000)
        }

        return result
      } catch (error) {
        log.error('Failed to start llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        sendToRenderer('error', { message: `llamacpp failed: ${error?.message}` })
        return null
      }
    })

    ipcMain.handle('llamacpp:stop', async () => {
      try {
        const info = getLlamaCppInfo()
        await stopLlamaCpp()
        sendToRenderer('status:llamacpp', 'stopped')
        if (info.url) {
          sendToRenderer('connections:openai', {
            action: 'remove',
            url: `${info.url}/v1`
          })
          setTimeout(() => sendToRenderer('models:refresh'), 500)
        }

        return true
      } catch (error) {
        log.error('Failed to stop llamacpp:', error)
        return false
      }
    })

    ipcMain.handle('llamacpp:info', () => getLlamaCppInfo())
    ipcMain.handle('llamacpp:logs', () => getLlamaCppLog())
    ipcMain.handle('llamacpp:pty:connect', () => connectLlamaCppPtyPort())

    ipcMain.handle('llamacpp:uninstall', async () => {
      try {
        const info = getLlamaCppInfo()
        await uninstallLlamaCpp()
        sendToRenderer('status:llamacpp', null)
        if (info.url) {
          sendToRenderer('connections:openai', {
            action: 'remove',
            url: `${info.url}/v1`
          })
          setTimeout(() => sendToRenderer('models:refresh'), 500)
        }
        await setConfig({ llamaCpp: { ...CONFIG?.llamaCpp, enabled: false } })
        CONFIG = await getConfig()
        return true
      } catch (error) {
        log.error('Failed to uninstall llamacpp:', error)
        return false
      }
    })

    ipcMain.handle('huggingface:models:list', () => listModels())
    ipcMain.handle('huggingface:models:dir', () => getModelsDir())
    ipcMain.handle('huggingface:models:delete', (_event, repo: string, filename: string) => {
      return deleteModel(repo, filename)
    })
    ipcMain.handle('huggingface:models:cancel', (_event, repo?: string, filename?: string) => {
      cancelDownload(repo, filename)
      return true
    })
    ipcMain.handle('huggingface:search', async (_event, query: string, token?: string) => {
      return searchModels(query, token)
    })
    ipcMain.handle('huggingface:repo:files', async (_event, repo: string, token?: string) => {
      return getRepoFiles(repo, token)
    })
    ipcMain.handle(
      'huggingface:models:download',
      async (_event, repo: string, filename: string, token?: string, expectedSize?: number) => {
        try {
          sendToRenderer('status:huggingface-download', {
            repo,
            filename,
            status: 'downloading',
            percent: 0
          })
          const filepath = await downloadModel(
            repo,
            filename,
            (progress) => {
              sendToRenderer('status:huggingface-download', {
                repo,
                filename,
                status: 'downloading',
                percent: progress.percent,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes
              })
            },
            token,
            expectedSize
          )
          sendToRenderer('status:huggingface-download', {
            repo,
            filename,
            status: 'done',
            filepath
          })
          return filepath
        } catch (error) {
          log.error('Failed to download model:', error)
          sendToRenderer('status:huggingface-download', {
            repo,
            filename,
            status: 'failed',
            error: error?.message
          })
          sendToRenderer('error', { message: `Model download failed: ${error?.message}` })
          return null
        }
      }
    )

    ipcMain.handle('package:version', (_event, packageName: string) =>
      getPackageVersion(packageName)
    )
    ipcMain.handle('package:uninstall', async (_event, packageName: string) => {
      const result = uninstallPackage(packageName)
      sendToRenderer('packages:changed', {
        'open-webui': isPackageInstalled('open-webui')
      })
      updateTray()
      return result
    })

    ipcMain.handle('dialog:selectFolder', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })

    ipcMain.handle('app:launchAtLogin:get', () => {
      return app.getLoginItemSettings().openAtLogin
    })
    ipcMain.handle('app:launchAtLogin:set', (_event, enabled: boolean) => {
      app.setLoginItemSettings({ openAtLogin: enabled })
    })

    ipcMain.handle('open:browser', async (_event, { url }) => {
      if (!url) throw new Error('No URL provided')
      let normalizedUrl = url
      if (normalizedUrl.startsWith('http://0.0.0.0')) {
        normalizedUrl = normalizedUrl.replace('http://0.0.0.0', 'http://localhost')
      }
      await openUrl(normalizedUrl)
    })

    ipcMain.handle('open:path', async (_event, folderPath: string) => {
      if (!folderPath) throw new Error('No path provided')
      await shell.openPath(folderPath)
    })

    ipcMain.handle('notification', async (_event, { title, body }) => {
      new Notification({ title, body }).show()
    })

    ipcMain.handle('llamacpp:check-update', async () => {
      try {
        return await checkLlamaCppUpdate()
      } catch (error) {
        log.error('Failed to check llamacpp update:', error)
        throw error
      }
    })

    ipcMain.handle('llamacpp:update', async () => {
      try {
        sendToRenderer('status:llamacpp', 'setting-up')
        const result = await updateLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
        })
        sendToRenderer('status:llamacpp', 'ready')
        return result
      } catch (error) {
        log.error('Failed to update llamacpp:', error)
        sendToRenderer('status:llamacpp', 'failed')
        sendToRenderer('error', { message: `llamacpp update failed: ${error?.message}` })
        throw error
      }
    })


    const trayIcon = nativeImage.createFromPath(icon)
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    tray.setToolTip('Open WebUI')
    updateTray()

    registerShortcuts(
      CONFIG.globalShortcut,
      CONFIG.spotlightShortcut,
      CONFIG.voiceInputShortcut,
      CONFIG.callShortcut
    )

    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          callback({ video: sources[0], audio: 'loopback' })
        })
      },
      { useSystemPicker: true }
    )

    validateOpenTerminalProcess()
    validateLlamaCppProcess()

    // Only the explicit startup preference opts in to a session-wide terminal service.
    if (CONFIG?.openTerminal?.enabled) {
      try {
        sendToRenderer('status:open-terminal', 'starting')
        const result = await startOpenTerminal((status) => {
          sendToRenderer('status:open-terminal-setup', status)
        })
        sendToRenderer('status:open-terminal', 'started')
        sendToRenderer('open-terminal:ready', result)
        scheduleOpenWebUISync()
      } catch (error) {
        log.error('Auto-start Open Terminal failed:', error)
        sendToRenderer('status:open-terminal', 'failed')
      }
    }

    // Restore workspaces on conversation activation, not startup, to avoid retaining unused directory handles.

    if (CONFIG?.llamaCpp?.enabled) {
      try {
        sendToRenderer('status:llamacpp', 'starting')
        const result = await startLlamaCpp((status) => {
          sendToRenderer('status:llamacpp-setup', status)
        })
        sendToRenderer('status:llamacpp', 'started')
        sendToRenderer('llamacpp:ready', result)
      } catch (error) {
        log.error('Auto-start llama.cpp failed:', error)
        sendToRenderer('status:llamacpp', 'failed')
      }
    }

    // Migrate legacy local connection entries out of the connections array
    if (CONFIG.connections.some((c) => c.type === 'local')) {
      CONFIG.connections = CONFIG.connections.filter((c) => c.type !== 'local')
      if (!CONFIG.defaultConnectionId || CONFIG.defaultConnectionId === 'local') {
        CONFIG.defaultConnectionId = 'local'
      }
      await setConfig(CONFIG)
      log.info('Migrated legacy local connection entry from connections array')
    }

    const defaultConn = await getDefaultConnection()
    if (defaultConn) {
      createMainWindow()
      const result = await connectTo(defaultConn)
      if (result) sendToRenderer('connection:open', result)
    } else {
      createMainWindow()
    }

    if (mainWindow) {
      initUpdater(mainWindow)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else {
        mainWindow?.show()
        mainWindow?.focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    isQuiting = true
    cancelOpenWebUISync()
    await workspacePreview.closeAll()
    await stopGithubFs()
    await stopLlamaCpp()
    await stopAllWorkspaceTerminals()
    await stopServerHandler()
    globalShortcut.unregisterAll()
    mainWindow = null
    contentWindow = null
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      spotlightWindow.destroy()
    }
    spotlightWindow = null
    if (voiceInputWindow && !voiceInputWindow.isDestroyed()) {
      voiceInputWindow.destroy()
    }
    voiceInputWindow = null
    tray?.destroy()
    tray = null
  })
}
