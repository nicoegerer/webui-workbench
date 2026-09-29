/** Real published i18next loader + dictionaries, with a new document for every saved locale. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { patchSettingsLocaleFallback } from '../src/main/services/workspace-frontend.ts'

const require = createRequire(import.meta.url)
const { TraceMap, eachMapping } = require('@jridgewell/trace-mapping')
const frontend = process.env.OPEN_WEBUI_FRONTEND

test(
  'published settings translate after restart with short, full, regional or stale locale codes',
  { skip: !frontend, timeout: 120_000 },
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'workbench-locales-'))
    const chunks = path.join(frontend!, '_app', 'immutable', 'chunks')
    let filename = '',
      code = '',
      init = '',
      store = ''
    for (const name of await readdir(chunks)) {
      if (!name.endsWith('.js.map')) continue
      const map = JSON.parse(await readFile(path.join(chunks, name), 'utf8'))
      const sourceIndex = map.sources.findIndex((s: string) => s.endsWith('/i18n/index.ts'))
      if (sourceIndex < 0) continue
      filename = name.slice(0, -4)
      const original = await readFile(path.join(chunks, filename), 'utf8')
      const lines = original.split('\n')
      const sourceLines = map.sourcesContent[sourceIndex].split('\n')
      const storeLine =
        sourceLines.findIndex((s: string) => s.includes('const i18n = createI18nStore')) + 1
      eachMapping(
        new TraceMap(map),
        (location: {
          source: string
          name: string
          originalLine: number
          generatedLine: number
          generatedColumn: number
        }) => {
          if (!location.source?.endsWith('/i18n/index.ts')) return
          const tail = lines[location.generatedLine - 1].slice(location.generatedColumn)
          const assignment = tail.match(/^([\w$]+)=/)
          if (location.name === 'initI18n' && assignment) init = assignment[1]
          if (location.name === 'i18n' && location.originalLine === storeLine && assignment)
            store = assignment[1]
        }
      )
      code = process.env.WORKSPACE_TEST_UNPATCHED
        ? original
        : (patchSettingsLocaleFallback(original, map) ?? original)
      break
    }
    assert.ok(filename && init && store, 'Published i18n initializer/store must be discoverable')
    code += `\nexport {${init} as DesktopTestInit, ${store} as DesktopTestStore};\n`
    const cases = ['de', 'en', 'de-DE', 'en-US', 'de-AT', 'zz-ZZ']
    const results: Array<{ locale: string; title: string; missing: string[]; error?: string }> = []
    let finish: (error?: Error) => void = () => {}
    const complete = new Promise<void>((resolve, reject) => {
      finish = (error) => (error ? reject(error) : resolve())
    })
    // Keep failures handled while the runner is being launched.
    void complete.catch(() => {})
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url!, 'http://127.0.0.1')
        if (url.pathname === '/report') {
          let body = ''
          for await (const part of request) body += part
          results.push(JSON.parse(body))
          response.end('ok')
          if (results.length === cases.length) finish()
        } else if (url.pathname === '/') {
          response.setHeader('Content-Type', 'text/html')
          response.end(`<!doctype html><meta charset="utf-8"><title>Locale regression</title><script type="module">
            import { DesktopTestInit as init, DesktopTestStore as store } from '/_app/immutable/chunks/${filename}';
            window.localeResult = (async () => {
              const locale = new URL(location.href).searchParams.get('locale');
              try {
                localStorage.setItem('locale', locale);
                await init(localStorage.locale, {});
                let i18n; const unsubscribe = store.subscribe(value => i18n = value); unsubscribe();
                const keys = ['settings.personal.interface.title', 'settings.personal.general.title', 'settings.personal.interface.sections.ui.title', 'settings.personal.interface.uiScale.label'];
                const missing = keys.filter(key => !i18n.t(key) || i18n.t(key) === key);
                const result = {locale, title:i18n.t(keys[0]), missing};
                await fetch('/report', {method:'POST', body:JSON.stringify(result)});
              } catch (error) { await fetch('/report', {method:'POST',body:JSON.stringify({locale,missing:[],error:String(error)})}); }
            })();
          </script>`)
        } else if (url.pathname.startsWith('/_app/immutable/')) {
          const relative = url.pathname.slice(1)
          const file = path.resolve(frontend!, relative)
          assert.ok(file.startsWith(path.resolve(frontend!) + path.sep))
          response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript')
          response.end(url.pathname.endsWith('/' + filename) ? code : await readFile(file))
        } else {
          response.writeHead(404)
          response.end()
        }
      } catch (error) {
        response.writeHead(500)
        response.end('Fixture error')
        finish(error as Error)
      }
    })
    let child: ReturnType<typeof spawn> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      assert.ok(address && typeof address === 'object')
      const runner = path.join(temporary, 'runner.cjs')
      await writeFile(
        runner,
        `const {app,BrowserWindow}=require('electron');
        app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
        app.whenReady().then(async()=>{
          const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
          for(const locale of ${JSON.stringify(cases)}) {
            await w.loadURL('http://127.0.0.1:${address.port}/?locale='+locale);
            await w.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0; const t=setInterval(()=>{if(window.localeResult){clearInterval(t);window.localeResult.then(resolve,reject)}else if(++n>200){clearInterval(t);reject(Error("Module load timeout"))}},50)})');
          }
          w.destroy(); app.quit();
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
      child.stdout?.on('data', (data) => {
        output += data
      })
      child.stderr?.on('data', (data) => {
        output += data
      })
      child.on('error', (error) => finish(error))
      child.on('exit', (code) => {
        if (results.length !== cases.length)
          finish(Error('Browser exited before completion: ' + code + ' ' + output.slice(-1000)))
      })
      deadline = setTimeout(
        () => finish(Error('Locale regression timeout: ' + output.slice(-1000))),
        90_000
      )
      await complete
      for (const result of results) {
        assert.equal(result.error, undefined)
        assert.deepEqual(
          result.missing,
          [],
          result.locale + ': missing semantic settings translations'
        )
        assert.equal(
          result.title,
          result.locale.startsWith('de') ? 'Benutzeroberfläche' : 'Interface'
        )
      }
      console.log('Real dictionaries: ' + results.map((r) => r.locale + ' → ' + r.title).join('; '))
    } finally {
      if (deadline) clearTimeout(deadline)
      child?.kill()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
      assert.ok(path.basename(temporary).startsWith('workbench-locales-'))
      await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
)
