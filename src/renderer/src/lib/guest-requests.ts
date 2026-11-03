// Embedded pages get these capabilities only, never the desktop process/config API.
import type { DesktopApi } from '../../../preload'

interface GuestAPI extends Pick<
  DesktopApi,
  | 'workspaceChooseFolder'
  | 'workspaceRecent'
  | 'workspaceListRepos'
  | 'workspaceOpenLocal'
  | 'workspaceEnsure'
  | 'workspaceKeepAlive'
  | 'workspaceMountRepo'
  | 'workspacePreviewInspect'
  | 'workspacePreviewOpen'
  | 'workspacePreviewClose'
  | 'workspacePreviewGetActive'
  | 'syncOpenWebUI'
  | 'setAuthToken'
> {
  getVersion(): Promise<unknown>
  openInBrowser(url: string): Promise<unknown>
  notification(title: string, body: string): Promise<unknown>
}
export async function handleGuestRequest(
  api: GuestAPI,
  request: {
    type?: string
    url?: unknown
    title?: unknown
    body?: unknown
    token?: unknown
    path?: string
    terminalId?: string
    ids?: string[]
    repoFullName?: string
    branch?: string
    id?: string
    entryPath?: string
  }
): Promise<unknown> {
  switch (request.type) {
    case 'token:update':
      if (typeof request.token !== 'string') throw new Error('Invalid token')
      return api.setAuthToken(request.token)
    case 'workspaceChooseFolder':
      return api.workspaceChooseFolder()
    case 'workspaceRecent':
      return api.workspaceRecent()
    case 'workspaceListRepos':
      return api.workspaceListRepos()
    case 'workspaceOpenLocal':
      return api.workspaceOpenLocal({ path: request.path ?? '' })
    case 'workspaceEnsure':
      return api.workspaceEnsure(request)
    case 'workspaceKeepAlive':
      return api.workspaceKeepAlive({ ids: request.ids ?? [] })
    case 'workspaceMountRepo':
      return api.workspaceMountRepo({
        repoFullName: request.repoFullName ?? '',
        branch: request.branch ?? ''
      })
    case 'workspacePreviewInspect':
      return api.workspacePreviewInspect({ terminalId: request.terminalId ?? '' })
    case 'workspacePreviewOpen':
      return api.workspacePreviewOpen({
        terminalId: request.terminalId ?? '',
        entryPath: request.entryPath
      })
    case 'workspacePreviewClose':
      return api.workspacePreviewClose({ id: request.id ?? '' })
    case 'workspacePreviewGetActive':
      return api.workspacePreviewGetActive()
    case 'syncOpenWebUI':
      return api.syncOpenWebUI()
    case 'getVersion':
      return api.getVersion()
    case 'app:info':
    case 'getAppInfo':
    case 'app:data':
      // Keep WebUI in its normal interface, without companion identity or state.
      return null
    case 'openInBrowser': {
      if (
        typeof request.url !== 'string' ||
        !['http:', 'https:'].includes(new URL(request.url).protocol)
      )
        throw new Error('Invalid URL')
      return api.openInBrowser(request.url)
    }
    case 'notification':
      if (
        typeof request.title !== 'string' ||
        typeof request.body !== 'string' ||
        request.title.length > 256 ||
        request.body.length > 4096
      )
        throw new Error('Invalid notification')
      return api.notification(request.title, request.body)
    default:
      throw new Error('Unsupported desktop request')
  }
}
