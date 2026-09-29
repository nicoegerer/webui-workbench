import { ipcRenderer, contextBridge } from 'electron'

// Relay typed {type, data} messages between desktop and guest; keep business logic outside this preload.

type EventCallback = (data: any) => void
const eventCallbacks: EventCallback[] = []
const pendingEvents: any[] = []
const MAX_PENDING_EVENTS = 50

ipcRenderer.on('desktop:event', (_event, data) => {
  if (eventCallbacks.length === 0) {
    pendingEvents.push(data)
    if (pendingEvents.length > MAX_PENDING_EVENTS) pendingEvents.shift()
    return
  }
  eventCallbacks.forEach((cb) => cb(data))
})

// Mirror Open WebUI theme changes through its applyTheme hook.
contextBridge.exposeInMainWorld('applyTheme', () => {
  const theme = localStorage.getItem('theme') ?? 'system'
  ipcRenderer.sendToHost('webview:event', { type: 'theme:update', data: { theme } })
})

contextBridge.exposeInMainWorld('electronAPI', {
  onEvent: (callback: EventCallback): void => {
    eventCallbacks.push(callback)
    const queued = pendingEvents.splice(0)
    queued.forEach((event) => callback(event))
  },

  send: (data: any): Promise<any> => {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      const handler = (_event: any, response: any) => {
        if (response?._responseId === id) {
          ipcRenderer.removeListener('desktop:response', handler)
          resolve(response.data)
        }
      }
      ipcRenderer.on('desktop:response', handler)
      ipcRenderer.sendToHost('webview:send', { ...data, _requestId: id })
    })
  },

  load: (page: string): void => {
    ipcRenderer.sendToHost('webview:load', page)
  }
})
