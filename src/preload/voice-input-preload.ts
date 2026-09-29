import { ipcRenderer, contextBridge } from 'electron'

const api = {
  onRecordingState: (
    callback: (data: { recording: boolean }) => void
  ): void => {
    ipcRenderer.on('voiceInput:state', (_event, data) => {
      callback(data)
    })
  },

  checkMicPermission: (): Promise<string> => {
    return ipcRenderer.invoke('voiceInput:micPermission')
  },

  transcribe: (audioBuffer: ArrayBuffer, token?: string): Promise<any> => {
    return ipcRenderer.invoke('voiceInput:transcribe', audioBuffer, token)
  },

  done: (text: string): void => {
    ipcRenderer.invoke('voiceInput:done', text)
  },

  close: (): void => {
    ipcRenderer.invoke('voiceInput:close')
  },

  error: (message: string): void => {
    ipcRenderer.invoke('voiceInput:error', message)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('voiceInputAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.voiceInputAPI = api
}
