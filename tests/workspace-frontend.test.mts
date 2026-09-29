import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  patchWorkspaceFileNav,
  prepareWorkspaceFrontend,
  patchSettingsLocaleFallback,
  resolveFrontendLocaleFallback
} from '../src/main/services/workspace-frontend.ts'

const sourceMap = {
  sources: ['../../src/lib/components/chat/FileNav.svelte'],
  sourcesContent: ["const useServerPath = !!chatId || savedPath === '/';"],
  names: ['useServerPath'],
  mappings: 'AAAAA'
}

test('new and existing chats always initialize FileNav from the selected terminal cwd', () => {
  const original = 'us=!!D()||Un==="/",next=1;'
  const patched = patchWorkspaceFileNav(original, sourceMap)!
  assert.equal(patched.length, original.length, 'Source-map columns must not shift')
  const useServerPath = new Function('D', 'Un', 'let us,next; ' + patched + ' return us;')
  assert.equal(
    useServerPath(() => null, 'C:/first-workspace'),
    true
  )
  assert.equal(
    useServerPath(() => 'existing-chat', 'C:/first-workspace'),
    true
  )
  assert.equal(patchWorkspaceFileNav(patched, sourceMap), patched, 'Idempotent across app starts')
})

test('unrelated assets remain untouched and changed upstream contracts fail explicitly', () => {
  assert.equal(patchWorkspaceFileNav('anything', { ...sourceMap, sources: ['unrelated.ts'] }), null)
  assert.throws(() => patchWorkspaceFileNav('us=someNewLogic;', sourceMap), /not found/)
  assert.throws(() => patchWorkspaceFileNav('us=!!secret,done=1;', sourceMap), /changed/)
  assert.throws(
    () => patchWorkspaceFileNav('us=true;', { ...sourceMap, sourcesContent: ['new source'] }),
    /changed/
  )
})

test('stored short, regional and unknown languages always have a shipped fallback', () => {
  const available = ['de-DE', 'en-GB', 'en-US', 'fr-FR', 'pt-BR']
  for (const [locale, expected] of [
    ['de', ['de-DE', 'en-US']],
    ['de-AT', ['de-DE', 'en-US']],
    ['DE_de', ['de-DE', 'en-US']],
    ['en', ['en-US']],
    ['en-GB', ['en-GB', 'en-US']],
    ['fr', ['fr-FR', 'en-US']],
    ['zz', ['en-US']],
    [undefined, ['en-US']]
  ] as const)
    assert.deepEqual(resolveFrontendLocaleFallback(locale, available), expected)
})

test('locale patch is scoped, idempotent and preserves all existing source-map columns', () => {
  const map = {
    sources: ['../../src/lib/i18n/index.ts'],
    sourcesContent: ["const fallbackDefaultLocale = defaultLocale ? [defaultLocale] : ['en-US'];"],
    names: ['fallbackDefaultLocale'],
    mappings: 'AAAAA'
  }
  const original =
    'e=r?[r]:["en-US"]; /* ./locales/de-DE/translation.json ./locales/en-US/translation.json */'
  const patched = patchSettingsLocaleFallback(original, map)!
  assert.equal(patched.slice(0, original.length).length, original.length)
  assert.equal(patched.indexOf(';'), original.indexOf(';'))
  const fallback = new Function('r', 'let e; ' + patched + '\nreturn e;')
  assert.deepEqual(fallback('de'), ['de-DE', 'en-US'])
  assert.deepEqual(fallback('invalid-locale'), ['en-US'])
  assert.equal(patchSettingsLocaleFallback(patched, map), patched)
  assert.equal(patchSettingsLocaleFallback(original, { ...map, sources: ['unrelated.ts'] }), null)
  assert.equal(
    patchSettingsLocaleFallback(original, { ...map, sourcesContent: ['new upstream initializer'] }),
    null
  )
  assert.throws(
    () => patchSettingsLocaleFallback(original.replace('e=r?', 'e=other?'), map),
    /not found/
  )
})

test('frontend preparation applies both fixes and preserves recoverable originals across restarts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workbench-frontend-'))
  try {
    const chunks = path.join(directory, '_app', 'immutable', 'chunks')
    await mkdir(chunks, { recursive: true })
    const fileNav = 'us=!!D()||Un==="/",next=1;'
    const locale =
      'e=r?[r]:["en-US"]; /* ./locales/de-DE/translation.json ./locales/en-US/translation.json */'
    const localeMap = {
      sources: ['../../src/lib/i18n/index.ts'],
      sourcesContent: [
        "const fallbackDefaultLocale = defaultLocale ? [defaultLocale] : ['en-US'];"
      ],
      names: ['fallbackDefaultLocale'],
      mappings: 'AAAAA'
    }
    for (const [name, code, map] of [
      ['file-nav', fileNav, sourceMap],
      ['locale', locale, localeMap]
    ] as const) {
      await writeFile(path.join(chunks, name + '.js'), code)
      await writeFile(path.join(chunks, name + '.js.map'), JSON.stringify(map))
    }
    await prepareWorkspaceFrontend(directory)
    const once = await readFile(path.join(chunks, 'locale.js'), 'utf8')
    assert.match(once, /workbench:locale-fallback-v1/)
    assert.match(await readFile(path.join(chunks, 'file-nav.js'), 'utf8'), /us=true/)
    await prepareWorkspaceFrontend(directory)
    assert.equal(await readFile(path.join(chunks, 'locale.js'), 'utf8'), once)
    assert.equal(await readFile(path.join(chunks, 'locale.js.desktop-original'), 'utf8'), locale)
    assert.equal(await readFile(path.join(chunks, 'file-nav.js.desktop-original'), 'utf8'), fileNav)
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('workbench-frontend-'))
    await rm(directory, { recursive: true, force: true })
  }
})
