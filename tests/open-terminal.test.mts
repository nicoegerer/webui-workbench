import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import crypto from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import { canReleaseWorkspaceTerminal } from '../src/shared/services/workspace-lifecycle.ts'

const runtimeVersions = JSON.parse(
  readFileSync(new URL('../src/shared/runtime-versions.json', import.meta.url), 'utf8')
)

// Exercise the actual lifecycle module without Electron or a user's profile.
function fixture(openTerminal: Record<string, unknown> = {}, installed = true) {
  const config = { openTerminal: { enabled: false, apiKey: 'fixture-only', ...openTerminal } }
  const children: Array<{ pid: number; exit: () => void; alive: boolean; port: number }> = []
  const installs: unknown[][] = []
  let failInstall = false
  const stubs = {
    crypto,
    os: { homedir: () => 'C:\\Users\\fixture' },
    path,
    'electron-log': { info() {}, warn() {} },
    electron: {
      app: { isPackaged: false, getAppPath: () => 'C:/app' },
      safeStorage: { isEncryptionAvailable: () => false }
    },
    'node-pty': {
      spawn(_program: string, args: string[]) {
        const child = {
          pid: children.length + 1000,
          exit: () => {},
          alive: true,
          port: Number(args[args.indexOf('--port') + 1])
        }
        children.push(child)
        return {
          pid: child.pid,
          onData() {},
          onExit(callback: (event: object) => void) {
            child.exit = () => {
              child.alive = false
              callback({ exitCode: 0 })
            }
          },
          kill() {
            child.exit()
          }
        }
      }
    },
    './service-lock': {
      isProcessAlive: (pid: number) => children.some((c) => c.pid === pid && c.alive)
    },
    '../../shared/runtime-versions.json': runtimeVersions,
    './index': {
      getConfig: async () => config,
      setConfig: async () => assert.fail('No preference changes expected'),
      getPythonPath: () => 'fixture-python',
      isPythonInstalled: () => true,
      isPackageInstalled: () => installed,
      installPackage: async (...args: unknown[]) => {
        installs.push(args)
        if (failInstall) throw Error('fixture install failed')
      },
      portInUse: async (port: number) => children.some((c) => c.port === port && c.alive)
    }
  }
  const source = readFileSync(
    new URL('../src/main/utils/open-terminal.ts', import.meta.url),
    'utf8'
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  const module = { exports: {} }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (id: keyof typeof stubs) => {
      assert.ok(id in stubs, 'Unexpected dependency: ' + id)
      return stubs[id]
    },
    process: { platform: 'win32', env: {} },
    Buffer,
    setTimeout: (callback: () => void) => setTimeout(callback, 0)
  })
  return {
    api: module.exports as typeof import('../src/main/utils/open-terminal.ts'),
    config,
    children,
    installs,
    failInstall: () => {
      failInstall = true
    }
  }
}

for (const options of [
  { enabled: false },
  { enabled: true },
  { enabled: false, cwd: 'C:\\Projects\\Example' }
]) {
  test(`explicit service survives an empty chat: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options)
    const terminal = await f.api.startOpenTerminal()
    assert.equal(f.api.isOpenTerminalService(terminal.id!), true)
    assert.equal(
      await canReleaseWorkspaceTerminal(
        async () => assert.fail('Owned services must not be probed'),
        () => f.api.isOpenTerminalService(terminal.id!)
      ),
      false
    )
    assert.equal(f.config.openTerminal.enabled, options.enabled, 'Start must not enable autostart')
    await f.api.stopOpenTerminal()
    assert.equal(f.api.isOpenTerminalService(terminal.id!), false)
    assert.equal(f.children[0].alive, false)
  })
}

test('chat workspaces still release; manual Start can acquire the existing process', async () => {
  const f = fixture()
  const terminal = await f.api.startWorkspaceTerminal('C:\\Users\\fixture')
  assert.equal(f.api.isOpenTerminalService(terminal.id!), false)
  assert.equal(await canReleaseWorkspaceTerminal(async () => Response.json([])), true)
  await Promise.all([f.api.startOpenTerminal(), f.api.startOpenTerminal()])
  assert.equal(f.children.length, 1)
  assert.equal(f.api.isOpenTerminalService(terminal.id!), true)
  f.children[0].exit()
  assert.equal(f.api.isOpenTerminalService(terminal.id!), false, 'Exit releases ownership')
})

test('Start arriving during an idle probe prevents release', async () => {
  const f = fixture()
  const terminal = await f.api.startWorkspaceTerminal('C:\\Users\\fixture')
  const result = await canReleaseWorkspaceTerminal(
    async () => {
      await f.api.startOpenTerminal()
      return Response.json([])
    },
    () => f.api.isOpenTerminalService(terminal.id!)
  )
  assert.equal(result, false)
  assert.equal(f.children[0].alive, true)
})

test('failed installation releases pending ownership; a successful install uses the tested runtime', async () => {
  const failed = fixture({}, false)
  failed.failInstall()
  await assert.rejects(failed.api.startOpenTerminal(), /fixture install failed/)
  assert.equal(
    failed.api.isOpenTerminalService(failed.api.workspaceTerminalId('C:\\Users\\fixture')),
    false
  )
  const working = fixture({}, false)
  await working.api.startOpenTerminal()
  assert.deepEqual(working.installs[0].slice(0, 2), ['open-terminal', runtimeVersions.openTerminal])
})

test('an explicitly selected terminal version is respected', async () => {
  const f = fixture({ version: 'fixture-pinned-version' }, false)
  await f.api.startOpenTerminal()
  assert.deepEqual(f.installs[0].slice(0, 2), ['open-terminal', 'fixture-pinned-version'])
})

test('cleanup checks live ownership before probing and again before stopping', () => {
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const handler = main.slice(
    main.indexOf("ipcMain.handle('workspace:chip:keep-alive'"),
    main.indexOf("'workspace:chip:cloud'")
  )
  assert.equal((handler.match(/isOpenTerminalService\(terminal.id\)/g) || []).length, 4)
  assert.doesNotMatch(handler, /config.openTerminal\?\.enabled/)
  assert.match(
    main,
    /log.error\('Failed to start Open Terminal:'[\s\S]*?throw new Error\(`Open Terminal failed:/
  )
})
