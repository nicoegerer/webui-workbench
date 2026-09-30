import { mount, unmount, tick } from 'svelte'
import { config } from '../../src/renderer/src/lib/stores'
import Connectors from '../../src/renderer/src/lib/components/Main/Settings/Services/ConnectorSettings.svelte'
import Terminal from '../../src/renderer/src/lib/components/Main/Settings/OpenTerminal.svelte'
import Inference from '../../src/renderer/src/lib/components/Main/Settings/InferenceRuntime.svelte'

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
async function until(predicate: () => unknown) {
  for (let n = 0; n < 100; n++) {
    await tick()
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('UI condition timed out: ' + document.body.innerText.slice(-1200))
}
const field = (name: string) => {
  const label = [...document.querySelectorAll('form label')].find((el) =>
    el.textContent?.trim().startsWith(name)
  )
  const input = label?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input,select,textarea'
  )
  if (!input) throw new Error('Field missing: ' + name)
  return input
}
const enter = (name: string, value: string) => {
  const input = field(name)
  input.value = value
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const click = (text: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === text
  )
  if (!button) throw new Error('Button missing: ' + text)
  button.click()
}

async function run() {
  const target = document.getElementById('app')!
  let saved: any
  let portFails = false
  let previewCalls = 0
  let unsubscriptions = 0
  let failStart = false
  let starts = 0
  let stops = 0
  let profile: any = { openTerminal: { enabled: false }, llamaCpp: { enabled: false } }
  let info: any = { status: 'stopped', binaryPath: '/fixture/llama-server' }
  window.electronAPI = {
    listManagedServices: async () => [],
    onData: () => () => {
      unsubscriptions++
    },
    suggestManagedServicePort: async () => {
      if (portFails) throw new Error('fixture port unavailable')
      return 8001
    },
    previewManagedService: async () => {
      previewCalls++
      throw new Error('id must be a valid string')
    },
    saveManagedService: async (payload: any) => {
      saved = payload
      return { ...payload, id: 'fixture', status: 'starting', restartCount: 0, ownsProcess: true }
    },
    getConfig: async () => structuredClone(profile),
    setConfig: async (value: any) => {
      profile = { ...profile, ...value }
    },
    getPackageVersion: async () => 'fixture-version',
    getOpenTerminalInfo: async () => info,
    getLlamaCppInfo: async () => info,
    startOpenTerminal: async () => start(),
    startLlamaCpp: async () => start(),
    stopOpenTerminal: async () => {
      stops++
    },
    stopLlamaCpp: async () => {
      stops++
    }
  } as any
  const start = () => {
    starts++
    if (failStart) throw new Error('fixture startup failed')
    info = { ...info, status: 'started', url: 'http://127.0.0.1:9000', pid: 123 }
    return info
  }

  let component: any = mount(Connectors, { target })
  await until(() => document.querySelector('.advanced-tools'))
  document.querySelector<HTMLDetailsElement>('.advanced-tools')!.open = true
  click('Add local process')
  await until(() => document.querySelector('form'))
  document.querySelector<HTMLDetailsElement>('.editor-advanced')!.open = true
  enter('Name', 'Fixture gateway')
  enter('Program', 'C:\\Program Files\\nodejs\\node.exe')
  enter('Arguments', 'C:\\fixture\\gateway.mjs\n--no-open')
  enter('Connection type', 'mcpo')
  await until(() => document.querySelector('input[placeholder="uvx"]'))
  enter('Connection type', 'generic')
  await until(() => !document.querySelector('input[placeholder="uvx"]'))
  check(field('Program').value === 'C:\\Program Files\\nodejs\\node.exe', 'Actual executable lost')
  check(field('Arguments').value.endsWith('--no-open'), 'Arguments lost')
  check(previewCalls === 0, 'Type change used the ID-requiring preview endpoint')
  check(!document.querySelector('[role="alert"]'), 'Spurious ID error')
  check(
    document.body.innerText.includes('Start automatically with Desktop'),
    'Wrong process-type form'
  )
  portFails = true
  enter('Connection type', 'mcpo')
  await until(() =>
    document.querySelector('[role="alert"]')?.textContent?.includes('port unavailable')
  )
  check(field('Connection type').value === 'generic', 'Failed conversion left mismatched select')
  portFails = false
  document.querySelector<HTMLFormElement>('form')!.requestSubmit()
  await until(() => saved && !document.querySelector('form'))
  check(
    saved.type === 'generic' && saved.id === undefined && !saved.mcpo,
    'Wrong saved connector type'
  )
  check(
    saved.command.endsWith('node.exe') && saved.args.length === 2,
    'Saved wrapper instead of server'
  )
  check(document.body.innerText.includes('Connecting'), 'Background startup is not visible')
  await unmount(component)

  for (const [Component, key] of [
    [Terminal, 'openTerminal'],
    [Inference, 'llamaCpp']
  ] as const) {
    profile = { openTerminal: { enabled: false }, llamaCpp: { enabled: false } }
    info = { status: 'stopped', binaryPath: '/fixture/llama-server' }
    config.set(profile)
    starts = 0
    stops = 0
    failStart = true
    component = mount(Component, { target })
    const switchButton = () =>
      key === 'openTerminal'
        ? target.querySelector<HTMLButtonElement>(
            '[aria-label="settings.terminal.toggleStartOnLaunch"]'
          )
        : target.querySelector<HTMLButtonElement>('button.w-9')
    await until(switchButton)
    check(starts === 0 && !profile[key].enabled, 'Mount enabled a service by default')
    switchButton()!.click()
    await until(() => target.textContent?.includes('fixture startup failed'))
    check(starts === 1 && profile[key].enabled, 'Autostart did not attempt immediate start')
    switchButton()!.click()
    await until(() => !profile[key].enabled)
    failStart = false
    switchButton()!.click()
    await until(() => starts === 2 && target.textContent?.includes('127.0.0.1:9000'))
    switchButton()!.click()
    await until(() => !profile[key].enabled)
    check(stops === 0, 'Disabling future autostart stopped a running session')
    await unmount(component)
  }
  check(unsubscriptions === 2, 'Status subscription was leaked')
  return {
    passed: [
      'unsaved MCP conversion',
      'failed conversion rollback',
      'nonblocking save',
      'Open Terminal opt-in and retry',
      'llama.cpp opt-in and retry',
      'listener cleanup'
    ]
  }
}

;(window as any).testResult = run().catch((error) => ({ error: String(error), stack: error.stack }))
