import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const lifecycle = await build({
  entryPoints: [fileURLToPath(new URL('../src/main/process/managedService.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm'
})
const { ManagedService } = await import(
  'data:text/javascript;base64,' + Buffer.from(lifecycle.outputFiles[0].text).toString('base64')
)
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/main/utils/llamacpp.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: [
    'tar',
    'electron-log',
    './index',
    './huggingface',
    '../process/managedService',
    '../process/nativePty'
  ]
})

interface TestChild {
  pid: number
  alive: boolean
  kills: boolean[]
  exit(): void
  onData(): { dispose(): void }
  onExit(callback: (event: object) => void): { dispose(): void }
  write(): void
  resize(): void
  kill(force: boolean): void
}
interface LlamaApi {
  startLlamaCpp(): Promise<{ pid: number | null; url: string | null }>
  stopLlamaCpp(): Promise<void>
  getLlamaCppInfo(): { pid: number | null; url: string | null; status: string }
}
const noop = (): void => undefined
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve inferred fixture control types.
function fixture() {
  const children: TestChild[] = []
  let healthy = true,
    failConfig = false,
    exitOnSpawn = false
  let configGate: Promise<void> | undefined
  const config = { llamaCpp: { enabled: false, version: 'fixture-version', variant: 'cpu' } }
  const stubs = {
    fs: { existsSync: () => true, readdirSync: () => [] },
    tar: {},
    'electron-log': { info: noop, warn: noop, error: noop },
    './huggingface': { getModelsDir: () => '/fixture/models' },
    './index': {
      async getConfig() {
        await configGate
        if (failConfig) throw new Error('fixture setup failure')
        return config
      },
      setConfig() {
        assert.fail('No preference changes expected')
      },
      getInstallDir: () => '/fixture',
      getProcessEnv: (env: unknown) => env,
      findAvailablePort: async () => 18881
    },
    '../process/managedService': {
      ManagedService,
      waitForReady: async (_probe: unknown, signal: AbortSignal) => {
        signal.throwIfAborted()
        if (!healthy) throw new Error('fixture service did not become ready')
      }
    },
    '../process/nativePty': {
      spawnPty() {
        const child: TestChild = {
          pid: children.length + 6000,
          alive: true,
          kills: [],
          exit: noop,
          onData: () => ({ dispose: noop }),
          write: noop,
          resize: noop,
          onExit(callback: (event: object) => void) {
            child.exit = () => {
              child.alive = false
              callback({ exitCode: 1 })
            }
            if (exitOnSpawn) queueMicrotask(child.exit)
            return { dispose: noop }
          },
          kill(force: boolean) {
            child.kills.push(force)
            child.exit()
          }
        }
        children.push(child)
        return child
      }
    }
  }
  const mod = { exports: {} as LlamaApi }
  new Function('require', 'module', 'exports', 'process', built.outputFiles[0].text)(
    (name: string) => stubs[name] ?? require(name),
    mod,
    mod.exports,
    { platform: 'win32', arch: 'x64', env: {} }
  )
  return {
    api: mod.exports,
    children,
    config,
    setHealthy(value: boolean) {
      healthy = value
    },
    failSetup(value: boolean) {
      failConfig = value
    },
    pauseSetup(gate?: Promise<void>) {
      configGate = gate
    },
    exitDuringStart() {
      exitOnSpawn = true
    }
  }
}

test('concurrent llama.cpp starts share the upstream service without enabling autostart', async () => {
  const f = fixture()
  const [first, second] = await Promise.all([f.api.startLlamaCpp(), f.api.startLlamaCpp()])
  assert.equal(first.pid, second.pid)
  assert.equal(f.children.length, 1)
  assert.equal(f.api.getLlamaCppInfo().status, 'started')
  assert.equal((await f.api.startLlamaCpp()).pid, first.pid)
  assert.equal(f.config.llamaCpp.enabled, false)
  await f.api.stopLlamaCpp()
  assert.equal(f.children[0].alive, false)
})

test('failed readiness cleans up the process and permits an explicit retry', async () => {
  const f = fixture()
  f.setHealthy(false)
  await assert.rejects(f.api.startLlamaCpp(), /did not become ready/)
  assert.equal(f.api.getLlamaCppInfo().status, 'failed')
  assert.equal(f.api.getLlamaCppInfo().url, null)
  assert.equal(f.children[0].alive, false)
  f.setHealthy(true)
  assert.ok((await f.api.startLlamaCpp()).url)
  assert.equal(f.children.length, 2)
  await f.api.stopLlamaCpp()
})

test('an early exit or setup failure cannot leave a ready or permanently locked service', async () => {
  const early = fixture()
  early.exitDuringStart()
  await assert.rejects(early.api.startLlamaCpp(), /Process exited/)
  assert.equal(early.api.getLlamaCppInfo().status, 'failed')
  const setup = fixture()
  setup.failSetup(true)
  await assert.rejects(setup.api.startLlamaCpp(), /fixture setup failure/)
  setup.failSetup(false)
  assert.ok((await setup.api.startLlamaCpp()).url)
  setup.children[0].exit()
  await setup.api.stopLlamaCpp()
  assert.deepEqual(setup.children[0].kills, [], 'An observed exit must never signal a reused PID')
})

test('Stop during preparation waits for cancellation and prevents a late spawn', async () => {
  const f = fixture()
  let release!: () => void
  f.pauseSetup(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const pending = f.api.startLlamaCpp()
  const rejected = assert.rejects(pending, /cancelled/)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const stopped = f.api.stopLlamaCpp()
  release()
  await Promise.all([stopped, rejected])
  assert.equal(f.children.length, 0)
  f.pauseSetup()
  assert.ok((await f.api.startLlamaCpp()).url)
  await f.api.stopLlamaCpp()
})
