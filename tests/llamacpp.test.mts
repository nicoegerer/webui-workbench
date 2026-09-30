import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import ts from 'typescript'

function fixture() {
  const children: any[] = []
  let healthy = true
  let failConfig = false
  let configGate: Promise<void> | undefined
  let exitOnSpawn = false
  class Lock {
    held = false
    acquire() {
      if (this.held) return false
      this.held = true
      return true
    }
    release() {
      this.held = false
    }
  }
  const config = { llamaCpp: { enabled: false, version: 'fixture-version', variant: 'cpu' } }
  const stubs = {
    fs: { existsSync: () => true },
    path,
    child_process: {},
    tar: {},
    'electron-log': { info() {}, warn() {}, error() {} },
    './huggingface': { getModelsDir: () => '/fixture/models' },
    './service-lock': {
      ServiceLock: Lock,
      isProcessAlive: (pid: number) => children.some((c) => c.pid === pid && c.alive)
    },
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
      portInUse: async () => false
    },
    'node-pty': {
      spawn() {
        const child = {
          pid: children.length + 6000,
          alive: true,
          onData() {},
          onExit(callback: (event: object) => void) {
            child.exit = () => {
              child.alive = false
              callback({ exitCode: 1 })
            }
            if (exitOnSpawn) child.exit()
          },
          exit() {},
          kill() {
            child.exit()
          }
        }
        children.push(child)
        return child
      }
    }
  }
  const source = readFileSync(new URL('../src/main/utils/llamacpp.ts', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      require: (id: string) => {
        assert.ok(id in stubs, id)
        return stubs[id]
      },
      process: {
        platform: 'win32',
        arch: 'x64',
        env: {},
        kill(pid: number, signal?: string | number) {
          const child = children.find((c) => c.pid === pid && c.alive)
          if (!child) throw new Error('not alive')
          if (signal === 'SIGKILL') child.exit()
        }
      },
      setTimeout: (callback: () => void) => {
        queueMicrotask(callback)
        return 0
      },
      AbortSignal,
      fetch: async () => ({ ok: healthy, json: async () => ({ status: 'ok' }) })
    }
  )
  return {
    api: exports as any,
    children,
    config,
    setHealthy: (value: boolean) => {
      healthy = value
    },
    failSetup: (value: boolean) => {
      failConfig = value
    },
    pauseSetup: (gate: Promise<void> | undefined) => {
      configGate = gate
    },
    exitDuringStart: () => {
      exitOnSpawn = true
    }
  }
}

test('concurrent llama.cpp starts share a single ready process even with autostart disabled', async () => {
  const f = fixture()
  const [first, second] = await Promise.all([f.api.startLlamaCpp(), f.api.startLlamaCpp()])
  assert.equal(first.pid, second.pid)
  assert.equal(f.children.length, 1)
  assert.equal(f.api.getLlamaCppInfo().status, 'started')
  assert.equal((await f.api.startLlamaCpp()).pid, first.pid)
  assert.equal(f.children.length, 1)
  assert.equal(f.config.llamaCpp.enabled, false)
  await f.api.stopLlamaCpp()
})

test('failed readiness never reports success, cleans up and permits a retry', async () => {
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

test('an early process exit and a setup failure are reported and release the startup guard', async () => {
  const early = fixture()
  early.exitDuringStart()
  await assert.rejects(early.api.startLlamaCpp(), /exited during startup/)
  assert.equal(early.api.getLlamaCppInfo().status, 'failed')
  const setup = fixture()
  setup.failSetup(true)
  await assert.rejects(setup.api.startLlamaCpp(), /fixture setup failure/)
  setup.failSetup(false)
  assert.ok((await setup.api.startLlamaCpp()).url)
  await setup.api.stopLlamaCpp()
})

test('Stop during setup prevents a late spawn and allows a later explicit start', async () => {
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
  await f.api.stopLlamaCpp()
  release()
  await rejected
  assert.equal(f.children.length, 0)
  f.pauseSetup(undefined)
  assert.ok((await f.api.startLlamaCpp()).url)
  await f.api.stopLlamaCpp()
})
