import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'

interface SourceMap {
  sources: string[]
  sourcesContent: string[]
  names: string[]
  mappings: string
}

function* namedLocations(
  map: SourceMap,
  sourceIndex: number,
  target: string
): Generator<{ generatedLine: number; generatedColumn: number }> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let file = 0,
    name = 0
  for (const [generatedLine, mappingLine] of map.mappings.split(';').entries()) {
    let generatedColumn = 0
    for (const segment of mappingLine.split(',')) {
      if (!segment) continue
      const fields: number[] = []
      let value = 0,
        shift = 0
      for (const character of segment) {
        const digit = alphabet.indexOf(character)
        if (digit < 0) throw new Error('Invalid frontend source map')
        value += (digit & 31) << shift
        if (digit & 32) {
          shift += 5
          continue
        }
        fields.push(value & 1 ? -(value >> 1) : value >> 1)
        value = 0
        shift = 0
      }
      generatedColumn += fields[0]
      if (fields.length < 4) continue
      file += fields[1]
      if (fields.length < 5) continue
      name += fields[4]
      if (file === sourceIndex && map.names[name] === target)
        yield { generatedLine, generatedColumn }
    }
  }
}

/** Keep all generated columns unchanged: store discovery uses these source maps. */
export function patchWorkspaceFileNav(code: string, map: SourceMap): string | null {
  const sourceIndex = map.sources.findIndex((name) =>
    name.endsWith('/components/chat/FileNav.svelte')
  )
  if (sourceIndex < 0) return null
  const source = map.sourcesContent[sourceIndex]
  if (!source?.includes("const useServerPath = !!chatId || savedPath === '/';")) {
    throw new Error(
      'Open WebUI FileNav initialization changed; workspace compatibility needs review.'
    )
  }
  const lines = code.split('\n')
  let patched = false
  for (const { generatedLine, generatedColumn } of namedLocations(
    map,
    sourceIndex,
    'useServerPath'
  )) {
    const tail = lines[generatedLine].slice(generatedColumn)
    const assignment = tail.match(/^([\w$]+=)(!![^,;]+|true\s*)(?=[,;])/)
    if (!assignment) continue // A later reference, not the declaration.
    const expression = assignment[2]
    if (!/^true\s*$/.test(expression) && !/^!![\w$()]+\|\|[\w$]+===["']\/["']$/.test(expression)) {
      throw new Error('Open WebUI FileNav generated initialization changed.')
    }
    const start = generatedColumn + assignment[1].length
    lines[generatedLine] =
      lines[generatedLine].slice(0, start) +
      'true'.padEnd(expression.length) +
      lines[generatedLine].slice(start + expression.length)
    patched = true
  }
  if (!patched)
    throw new Error('Open WebUI FileNav initialization was not found in its source map.')
  return lines.join('\n')
}

/** Short, regional and stale locale preferences must still resolve a shipped dictionary.
 * Appended to an upstream module as text: keep this function self-contained.
 */
export function resolveFrontendLocaleFallback(locale: unknown, available: string[]): string[] {
  const normalize = (value: string): string => value.replace(/_/g, '-').toLowerCase()
  const requested = typeof locale === 'string' ? normalize(locale.trim()) : ''
  const exact = available.find((name) => normalize(name) === requested)
  const base = requested.split('-')[0]
  const related = available.find((name) => normalize(name).split('-')[0] === base)
  const preferred = exact || (base === 'en' ? 'en-US' : related)
  return [...new Set([preferred, 'en-US'].filter((name): name is string => !!name))]
}

const LOCALE_PATCH_MARKER = '\n// workbench:locale-fallback-v1\n'

export function patchSettingsLocaleFallback(code: string, map: SourceMap): string | null {
  const sourceIndex = map.sources.findIndex((name) => name.endsWith('/i18n/index.ts'))
  if (sourceIndex < 0) return null
  if (code.includes(LOCALE_PATCH_MARKER)) return code
  // Unknown initializers are left intact and checked by the real-language regression test.
  if (!map.sourcesContent[sourceIndex]?.includes("defaultLocale ? [defaultLocale] : ['en-US']"))
    return null
  const languages = [
    ...new Set(
      [...code.matchAll(/\.\/locales\/([^/"']+)\/translation\.json/g)].map((match) => match[1])
    )
  ]
  if (!languages.includes('en-US') || code.includes('$WBL'))
    throw new Error('Unsupported Open WebUI locale loader')
  const lines = code.split('\n')
  let patched = false
  for (const { generatedLine, generatedColumn } of namedLocations(
    map,
    sourceIndex,
    'fallbackDefaultLocale'
  )) {
    const tail = lines[generatedLine].slice(generatedColumn)
    const assignment = tail.match(/^([\w$]+=)(([\w$]+)\?\[\3\]:\[["']en-US["']\])(?=[,;])/)
    if (!assignment) continue
    const replacement = `$WBL(${assignment[3]})`
    if (replacement.length > assignment[2].length)
      throw new Error('Locale initializer cannot preserve source-map columns')
    const start = generatedColumn + assignment[1].length
    lines[generatedLine] =
      lines[generatedLine].slice(0, start) +
      replacement.padEnd(assignment[2].length) +
      lines[generatedLine].slice(start + assignment[2].length)
    patched = true
  }
  if (!patched) throw new Error('Open WebUI locale fallback was not found in its source map')
  return (
    lines.join('\n') +
    LOCALE_PATCH_MARKER +
    `function $WBL(locale) { return (${resolveFrontendLocaleFallback.toString()})(locale,${JSON.stringify(languages)}) }\n`
  )
}

/** Small, idempotent runtime compatibility patch; preserve the original installed asset. */
export async function prepareWorkspaceFrontend(frontend: string): Promise<void> {
  const directory = path.join(frontend, '_app', 'immutable', 'chunks')
  let found = false
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.js.map')) continue
    const map = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as SourceMap
    const hasFileNav = map.sources.some((source) =>
      source.endsWith('/components/chat/FileNav.svelte')
    )
    const hasI18n = map.sources.some((source) => source.endsWith('/i18n/index.ts'))
    if (!hasFileNav && !hasI18n) continue
    const filename = path.join(directory, name.slice(0, -4))
    const code = await readFile(filename, 'utf8')
    const fileNavPatched = patchWorkspaceFileNav(code, map)
    const localePatched = patchSettingsLocaleFallback(fileNavPatched ?? code, map)
    const patched = localePatched ?? fileNavPatched
    if (patched === null) continue
    if (patched !== code) {
      // COPYFILE_EXCL: a retry never replaces the recoverable upstream original.
      await copyFile(filename, filename + '.desktop-original', 1).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      await writeFile(filename, patched)
    }
    if (fileNavPatched !== null) found = true
  }
  if (!found)
    throw new Error('Open WebUI FileNav source map is missing; cannot safely switch workspaces.')
}
