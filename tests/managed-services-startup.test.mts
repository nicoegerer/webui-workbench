import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import crypto from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'

function load(file: string, stubs: Record<string, unknown>, globals = {}) {
  const exports = {}
  const js = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  runInNewContext(js, {
    exports,
    require: (id: string) => {
      assert.ok(id in stubs, 'Unexpected import: ' + id)
      return stubs[id]
    },
    Buffer,
    URL,
    console,
    ...globals
  })
  return exports as any
}

const logger = { info() {}, warn() {}, error() {} }
const definition = () => ({
  id: 'fixture',
  name: 'Fixture',
  type: 'generic',
  command: 'fixture-server',
  args: [],
  env: {},
  enabled: true,
  autoRestart: true,
  restartLimit: 2,
  startupTimeoutMs: 1000
})

test('preview and saving accept an empty draft ID, while explicit invalid IDs remain rejected', () => {
  const { normalizeServiceDefinition } = load('src/main/services/registry.ts', {
    crypto,
    path,
    'fs/promises': {},
    electron: {},
    'electron-log': logger,
    '../../shared/services/omniroute-defaults': {},
    '../../shared/services/empty-registry': {},
    '../../shared/services/types': {},
    '../utils': {},
    './defaults': {},
    './network': {}
  })
  for (const id of ['', '   ', undefined]) {
    const result = normalizeServiceDefinition({ ...definition(), id })
    assert.match(result.id, /^[a-z0-9][a-z0-9._-]{0,63}$/)
    assert.equal(result.command, 'fixture-server')
  }
  assert.equal(normalizeServiceDefinition(definition()).id, 'fixture')
  assert.throws(() => normalizeServiceDefinition({ ...definition(), id: '../invalid' }), /id/)
})

function fixture(
  options: { health?: () => Promise<boolean>; portBusy?: boolean | Promise<boolean> } = {}
) {
  const children: any[] = []
  const timers: Array<{ run: () => void; cleared: boolean }> = []
  const services = new Map<string, any>()
  const registry = {
    async load() {},
    list: () => [...services.values()],
    get: (id: string) => services.get(id),
    async upsert(service: any) {
      services.set(service.id, service)
      return service
    },
    getApiKey: () => undefined,
    getAccessToken: () => undefined
  }
  class Logs {
    rows: string[] = []
    add(line: string) {
      this.rows.push(line)
    }
    append(line: string) {
      this.rows.push(line)
    }
    toArray() {
      return [...this.rows]
    }
  }
  const { ManagedServicesManager } = load(
    'src/main/services/manager.ts',
    {
      child_process: {
        spawn() {
          const child = new EventEmitter() as any
          child.stdout = new EventEmitter()
          child.stderr = new EventEmitter()
          child.pid = children.length + 7000
          child.exitCode = null
          children.push(child)
          queueMicrotask(() => child.emit('spawn'))
          return child
        }
      },
      electron: { app: { on() {} }, BrowserWindow: { getAllWindows: () => [] } },
      'electron-log': logger,
      '../../shared/services/types': {},
      './registry': {},
      './ring-buffer': { LineRingBuffer: Logs },
      './github-cli-bridge': {},
      './executables': { resolveExecutable: (command: string) => command },
      './network': {
        getPortFromService: (url?: string) => (url ? Number(new URL(url).port) : undefined),
        isPortInUse: async () => options.portBusy ?? false,
        isHealthCheckReady: options.health ?? (async () => true),
        waitForPortToClose: async () => true,
        delay: async () => {}
      }
    },
    {
      process: { platform: 'linux', env: {} },
      setTimeout(run: () => void) {
        const timer = { run, cleared: false }
        timers.push(timer)
        return timer
      },
      clearTimeout(timer: { cleared: boolean }) {
        timer.cleared = true
      }
    }
  )
  const manager = new ManagedServicesManager(registry)
  manager.terminateProcessTree = async (child: any) => {
    child.exitCode = 0
  }
  return { manager, children, timers, registry }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test('save returns starting immediately while readiness is pending; Stop cancels stale success', async () => {
  let ready!: (value: boolean) => void
  const pending = new Promise<boolean>((resolve) => {
    ready = resolve
  })
  const f = fixture({ health: () => pending })
  const saved = await f.manager.upsert({
    ...definition(),
    healthCheckUrl: 'http://127.0.0.1:9000/ready'
  })
  assert.equal(saved.status, 'starting')
  await flush()
  assert.equal(f.children.length, 1)
  await f.manager.stop(saved.id)
  ready(true)
  await flush()
  assert.equal(f.manager.list()[0].status, 'stopped')
})

test('disabled services save without starting; a manual start returns an immediate snapshot', async () => {
  const f = fixture()
  const saved = await f.manager.upsert({ ...definition(), enabled: false })
  assert.equal(saved.status, 'stopped')
  assert.equal(f.children.length, 0)
  assert.equal(f.manager.requestStart(saved.id).status, 'starting')
  await flush()
  assert.equal(f.manager.list()[0].status, 'running')
})

test('Stop during port discovery prevents a late process spawn', async () => {
  let complete!: (value: boolean) => void
  const f = fixture({
    portBusy: new Promise<boolean>((resolve) => {
      complete = resolve
    })
  })
  await f.manager.upsert({ ...definition(), healthCheckUrl: 'http://127.0.0.1:9000/ready' })
  await f.manager.stop('fixture')
  complete(false)
  await flush()
  assert.equal(f.children.length, 0)
  assert.equal(f.manager.list()[0].status, 'stopped')
})

test('Stop during a remote endpoint check ignores its late successful result', async () => {
  let complete!: (value: boolean) => void
  const f = fixture({
    health: () =>
      new Promise<boolean>((resolve) => {
        complete = resolve
      })
  })
  await f.manager.upsert({
    ...definition(),
    type: 'remote',
    remote: { url: 'https://example.invalid/mcp' }
  })
  await f.manager.stop('fixture')
  complete(true)
  await flush()
  assert.equal(f.manager.list()[0].status, 'stopped')
})

test('a delayed exit from an old generation cannot stop its replacement', async () => {
  const f = fixture()
  await f.manager.upsert(definition())
  await flush()
  const old = f.children[0]
  await f.manager.upsert({ ...definition(), args: ['--changed'] })
  await flush()
  assert.equal(f.children.length, 2)
  old.emit('exit', 0, null)
  assert.equal(f.manager.list()[0].status, 'running')
  assert.equal(f.manager.list()[0].pid, f.children[1].pid)
})

test('automatic failures stop at the restart limit instead of oscillating indefinitely', async () => {
  const f = fixture()
  await f.manager.upsert(definition())
  await flush()
  for (let failure = 0; failure < 3; failure++) {
    const child = f.children.at(-1)
    child.exitCode = 1
    child.emit('exit', 1, null)
    if (failure < 2) {
      f.timers.at(-1)!.run()
      await flush()
    }
  }
  assert.equal(f.children.length, 3)
  assert.equal(f.timers.length, 2)
  assert.equal(f.manager.list()[0].status, 'failed')
})

test('manual retry cancels queued backoff and a port conflict does not trigger a restart loop', async () => {
  const f = fixture()
  await f.manager.upsert(definition())
  await flush()
  f.children[0].exitCode = 1
  f.children[0].emit('exit', 1, null)
  f.manager.requestStart('fixture')
  await flush()
  assert.equal(f.timers[0].cleared, true)
  assert.equal(f.children.length, 2)
  const busy = fixture({ portBusy: true, health: async () => false })
  await busy.manager.upsert({ ...definition(), healthCheckUrl: 'http://127.0.0.1:9000/ready' })
  await flush()
  assert.equal(busy.children.length, 0)
  assert.equal(busy.timers.length, 0)
  assert.match(busy.manager.list()[0].lastError, /Port 9000/)
})
