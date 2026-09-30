import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { compile } from 'svelte/compiler'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')

test('actual service settings preserve connector type and start optional runtimes on opt-in', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'workbench-service-settings-'))
  const bundle = await build({
    entryPoints: [path.join(root, 'tests/fixtures/service-settings-client.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    conditions: ['browser'],
    plugins: [
      {
        name: 'settings-fixture',
        setup(builder) {
          builder.onResolve({ filter: /\/lib\/stores$|^(\.\.\/)+stores$/ }, () => ({
            path: 'stores',
            namespace: 'fixture'
          }))
          builder.onResolve({ filter: /^(\.\.\/)+i18n$/ }, () => ({
            path: 'i18n',
            namespace: 'fixture'
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
            contents:
              name === 'stores'
                ? "import { writable } from 'svelte/store'; export const config = writable({});"
                : "import { writable } from 'svelte/store'; export default writable({t:key=>key});",
            resolveDir: root
          }))
          builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => ({
            contents: compile(await readFile(filename, 'utf8'), {
              filename,
              generate: 'client',
              css: 'injected'
            }).js.code,
            resolveDir: path.dirname(filename)
          }))
        }
      }
    ]
  })
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html')
    response.end(
      request.url === '/app.js'
        ? bundle.outputFiles[0].contents
        : '<div id="app"></div><script src="/app.js"></script>'
    )
  })
  let child: ReturnType<typeof spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const runner = path.join(temporary, 'runner.cjs')
    await writeFile(
      runner,
      `const {app,BrowserWindow}=require('electron');
      app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});
      app.commandLine.appendSwitch('lang','en-US');
      app.whenReady().then(async()=>{
        const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
        await w.loadURL('http://127.0.0.1:${address.port}');
        const result=await w.webContents.executeJavaScript('window.testResult');
        console.log('SETTINGS_RESULT:'+JSON.stringify(result));
        w.destroy();app.exit(result?.error?1:0);
      }).catch(e=>{console.error(e);app.exit(1)});`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(require('electron'), [runner], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.on('error', reject)
      child!.on('exit', resolve)
      timer = setTimeout(
        () => reject(Error('Settings browser timeout: ' + output.slice(-1800))),
        60_000
      )
    })
    assert.equal(code, 0, output.slice(-2500))
    const line = output.split(/\r?\n/).find((line) => line.startsWith('SETTINGS_RESULT:'))
    assert.ok(line, output.slice(-1200))
    const result = JSON.parse(line.slice('SETTINGS_RESULT:'.length))
    assert.equal(result.error, undefined)
    assert.equal(result.passed.length, 6)
    console.log(result.passed.join('; '))
  } finally {
    if (timer) clearTimeout(timer)
    child?.kill()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temporary).startsWith('workbench-service-settings-'))
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
