import { session, ipcMain, dialog, type BrowserWindow } from 'electron'
import path from 'path'
import log from 'electron-log'
import { getConfig, isPackageInstalled, openUrl, webuiService } from '../utils'
import { initializeManagedServices, getManagedServicesManager } from './index'
import { WorkspacePreviewError, WorkspacePreviewManager } from './workspace-preview'
import { createWorkspacePreviewHandlers } from './workspace-preview-ipc'
import { canReleaseWorkspaceTerminal } from '../../shared/services/workspace-lifecycle'
import {
  getWorkspacePreviewRequestHeaders,
  isWorkspacePreviewNavigationAllowed
} from '../../shared/workspace-preview'
import {
  configureGithubFs,
  getGithubPreviewSource,
  listGithubMounts,
  listGithubPreviewWorkspaces,
  mountGithubRepo,
  stopGithubFs,
  unmountGithubRepos
} from './github-fs'

import {
  cancelOpenWebUISync,
  configureOpenWebUISync,
  scheduleOpenWebUISync,
  syncOpenWebUI
} from './open-webui-sync'

import {
  listGithubRepositories,
  listWorkspaces,
  rememberWorkspace,
  setWorkspaceActive
} from '../utils/workspaces'

import {
  startOpenTerminal,
  stopOpenTerminal,
  getOpenTerminalInfo,
  isOpenTerminalService,
  listWorkspaceTerminals,
  startWorkspaceTerminal,
  stopWorkspaceTerminal,
  stopAllWorkspaceTerminals,
  workspaceTerminalId
} from '../utils/open-terminal'

interface WorkbenchContext {
  getMainWindow(): BrowserWindow | null
  sendToRenderer(type: string, data?: unknown): void
}

export function createWorkbench({ getMainWindow, sendToRenderer }: WorkbenchContext): {
  initialize(): Promise<void>
  protectWindow(window: BrowserWindow): void
  stop(): Promise<void>
} {
  let AUTH_TOKEN: string | null = null
  const workspacePreviewManager = new WorkspacePreviewManager()
  const workspacePreview = createWorkspacePreviewHandlers({
    manager: workspacePreviewManager,
    listTerminals: () => [...listWorkspaceTerminals(), ...listGithubPreviewWorkspaces()],
    getRemoteSource: getGithubPreviewSource,
    // Generated pages have no IPC bridge; only the desktop's own main frame may request previews.
    isTrustedSender: (event) => {
      const mainWindow = getMainWindow()
      const request = event as Electron.IpcMainInvokeEvent | null
      return Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        request?.sender === mainWindow.webContents &&
        request.senderFrame === mainWindow.webContents.mainFrame
      )
    },
    describeError: (cause) =>
      cause instanceof WorkspacePreviewError
        ? { ok: false, code: cause.code, error: cause.message }
        : { ok: false, code: 'PREVIEW_START_FAILED', error: 'The website preview could not start.' }
  })

  function protectWindow(window: BrowserWindow): void {
    window.webContents.on('will-frame-navigate', (event) => {
      if (
        !event.isMainFrame &&
        !isWorkspacePreviewNavigationAllowed(event.url, workspacePreviewManager.getActive()?.url)
      )
        event.preventDefault()
    })
    window.webContents.setWindowOpenHandler((details) => {
      const active = workspacePreviewManager.getActive()
      if (!active || !isWorkspacePreviewNavigationAllowed(details.referrer?.url, active.url)) {
        openUrl(details.url)
      }
      return { action: 'deny' }
    })
  }

  async function initialize(): Promise<void> {
    // Opaque sandboxed frames omit Referer for CSS/modules. Supply only the
    // preview's own capability, only to its current origin and trusted renderer.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const mainWindow = getMainWindow()
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

    ipcMain.handle('app:setAuthToken', (event, token: unknown) => {
      if (
        event.sender !== getMainWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return
      if (typeof token !== 'string') return
      const changed = AUTH_TOKEN !== (token || null)
      AUTH_TOKEN = token || null
      if (changed) scheduleOpenWebUISync()
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
        const message = error instanceof Error ? error.message : String(error)
        sendToRenderer('error', { message: `Open Terminal failed: ${message}` })
        throw new Error(`Open Terminal failed: ${message}`)
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

    // Register through the main process so synchronization does not require an existing webview.
    configureOpenWebUISync({
      resolveBaseUrl: () =>
        webuiService.info.reachable && webuiService.info.url ? webuiService.info.url : null,
      resolveToken: () => AUTH_TOKEN,
      listToolTargets: () => getManagedServicesManager()?.getToolTargets() ?? [],
      onResult: (result) => sendToRenderer('open-webui:sync', result)
    })

    // The repository view reuses the connector's token; it never asks for one.
    configureGithubFs(
      () => getManagedServicesManager()?.getGithubAccessToken() ?? null,
      () => getManagedServicesManager()?.getGithubCliRequest() ?? null
    )

    await initializeManagedServices()
    {
      getManagedServicesManager()?.onChange(() => scheduleOpenWebUISync())
      scheduleOpenWebUISync()
    }

    webuiService.subscribe((event) => {
      if (event.type !== 'state') return
      if (event.info.reachable) scheduleOpenWebUISync()
      else cancelOpenWebUISync()
    })
    const config = await getConfig()
    if (config.openTerminal?.enabled) {
      void startOpenTerminal()
        .then(() => scheduleOpenWebUISync())
        .catch((error) => log.error('Auto-start Open Terminal failed:', error))
    }
  }

  async function stop(): Promise<void> {
    cancelOpenWebUISync()
    await Promise.all([
      workspacePreview.closeAll(),
      stopAllWorkspaceTerminals(),
      stopGithubFs(),
      getManagedServicesManager()?.stopAll()
    ])
  }
  return { initialize, protectWindow, stop }
}
