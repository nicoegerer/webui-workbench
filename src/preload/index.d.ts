import type { DesktopApi } from './index'

declare global {
  interface Window {
    electron: { process: { versions: NodeJS.ProcessVersions } }
    electronAPI: DesktopApi
    api: unknown
  }
}
