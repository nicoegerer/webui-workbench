/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript CI entry point. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export const compareStable = (left, right) => {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Not a stable version: ${value}`)
    return value.split('.').map(Number)
  }
  const a = parse(left),
    b = parse(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export function nextServicesVersion(previous, upstream) {
  const match = /^(\d+\.\d+\.\d+)-(services|workbench)\.(\d+)$/.exec(previous)
  if (!match) throw new Error(`Not a fork release: ${previous}`)
  const newerBase = compareStable(upstream, match[1]) > 0
  return `${newerBase ? upstream : match[1]}-${match[2]}.${newerBase ? 1 : Number(match[3]) + 1}`
}

/** Three-way merge, never an unconditional "ours" dependency/lockfile strategy. */
export function mergeForkManifest(file, base, ours, theirs) {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const ownValue = (value, key) => (value && Object.hasOwn(value, key) ? value[key] : undefined)
  const ownedIdentity = (path) =>
    (path.length === 1 &&
      (file === 'package.json'
        ? ['name', 'version', 'description', 'homepage', 'repository', 'bugs']
        : ['name', 'version']
      ).includes(path[0])) ||
    (file === 'package-lock.json' &&
      path.length === 3 &&
      path[0] === 'packages' &&
      path[1] === '' &&
      ['name', 'version'].includes(path[2]))
  const merge = (ancestor, local, incoming, path) => {
    if (isDeepStrictEqual(local, incoming) || isDeepStrictEqual(incoming, ancestor)) return local
    if (isDeepStrictEqual(local, ancestor)) return incoming
    if (ownedIdentity(path)) return local
    if (object(local) && object(incoming) && (object(ancestor) || ancestor === undefined)) {
      const entries = []
      for (const key of new Set([
        ...Object.keys(ancestor ?? {}),
        ...Object.keys(local),
        ...Object.keys(incoming)
      ])) {
        const value = merge(
          ownValue(ancestor, key),
          ownValue(local, key),
          ownValue(incoming, key),
          [...path, key]
        )
        if (value !== undefined) entries.push([key, value])
      }
      return Object.fromEntries(entries)
    }
    throw new Error(`Unresolved manifest conflict: ${file} ${JSON.stringify(path)}`)
  }
  if (
    !['package.json', 'package-lock.json'].includes(file) ||
    ![base, ours, theirs].every(object)
  ) {
    throw new Error('Only object-shaped package manifests may be reconciled')
  }
  return merge(base, ours, theirs, [])
}

/** Retain both new release-note sections only when existing history is unchanged. */
export function mergeChangelogAdditions(base, ours, theirs) {
  const normalize = (text) => text.replace(/\r\n/g, '\n').trimEnd() + '\n'
  ;[base, ours, theirs] = [base, ours, theirs].map(normalize)
  if (ours === theirs || theirs === base) return ours
  if (ours === base) return theirs
  const index = base.indexOf('\n## [')
  if (index < 0) throw new Error('No common changelog version history')
  const preamble = base.slice(0, index),
    history = base.slice(index)
  const additions = (text) => {
    if (!text.startsWith(preamble) || !text.endsWith(history)) {
      throw new Error('Existing changelog content changed; manual review required')
    }
    const added = text.slice(preamble.length, text.length - history.length)
    if (added && !added.startsWith('\n## [')) throw new Error('Unrecognized changelog insertion')
    return added
  }
  const local = additions(ours),
    incoming = additions(theirs)
  const versions = (text) => [...text.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1])
  const allVersions = [...versions(local), ...versions(incoming), ...versions(history)]
  if (new Set(allVersions).size !== allVersions.length) {
    throw new Error('Overlapping changelog versions require manual review')
  }
  return preamble + local + incoming + history
}

function mergeOfficialUpstream(cwd, git) {
  try {
    git('merge', '--no-edit', 'upstream/main')
  } catch (cause) {
    const files = git('diff', '--name-only', '--diff-filter=U', '-z').split('\0').filter(Boolean)
    if (!files.length) throw cause
    // Resolve every conflict in memory first. Any unrelated conflict aborts the merge.
    const reconciled = files.map((file) => {
      if (!['package.json', 'package-lock.json', 'CHANGELOG.md'].includes(file)) throw cause
      const versions = [1, 2, 3].map((stage) => git('show', `:${stage}:${file}`))
      const content =
        file === 'CHANGELOG.md'
          ? mergeChangelogAdditions(...versions)
          : JSON.stringify(
              mergeForkManifest(file, ...versions.map((text) => JSON.parse(text))),
              null,
              2
            ) + '\n'
      return [file, content]
    })
    for (const [file, content] of reconciled) writeFileSync(resolve(cwd, file), content)
    git('add', '--', ...files)
    git('commit', '--no-edit')
  }
}

/** Prepare only. CI tests the candidate before atomically pushing any branch. */
export function prepareSync(cwd, backendTag) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const read = (path) => JSON.parse(readFileSync(resolve(cwd, path), 'utf8'))
  const write = (path, value) =>
    writeFileSync(resolve(cwd, path), JSON.stringify(value, null, 2) + '\n')
  if (git('status', '--porcelain')) throw new Error('Sync requires a clean checkout')
  git('merge-base', '--is-ancestor', 'origin/main', 'upstream/main')
  const baseline = git('rev-parse', 'HEAD')
  const previous = read('package.json').version
  const backendVersion = backendTag.replace(/^v/, '')
  compareStable(backendVersion, backendVersion)
  try {
    git('merge', '--no-edit', 'origin/managed-services')
    mergeOfficialUpstream(cwd, git)
  } catch (error) {
    try {
      git('merge', '--abort')
    } catch {
      /* no merge in progress */
    }
    throw new Error('Upstream merge conflict; no branches were pushed', { cause: error })
  }
  const runtimePath = 'src/shared/runtime-versions.json'
  const runtime = read(runtimePath)
  const runtimeChanged = compareStable(backendVersion, runtime.openWebUI) > 0
  if (runtimeChanged) {
    runtime.openWebUI = backendVersion
    write(runtimePath, runtime)
  }
  const changed = baseline !== git('rev-parse', 'HEAD') || runtimeChanged
  if (!changed) return { changed: false, version: previous, backend: runtime.openWebUI }
  const upstream = JSON.parse(git('show', 'upstream/main:package.json')).version
  const version = nextServicesVersion(previous, upstream)
  const pkg = read('package.json'),
    lock = read('package-lock.json')
  pkg.version = lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  write('package.json', pkg)
  write('package-lock.json', lock)
  const changelogPath = resolve(cwd, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8')
  const index = changelog.indexOf('\n## [')
  const entry = `\n## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n### Changed\n\n- Integrated official Desktop upstream and Open WebUI ${runtime.openWebUI}; retained the fork's optional connector and workspace features.\n`
  writeFileSync(
    changelogPath,
    index < 0 ? changelog + entry : changelog.slice(0, index) + entry + changelog.slice(index)
  )
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md', runtimePath)
  git('commit', '-m', `chore: release v${version}`)
  return { changed: true, version, backend: runtime.openWebUI }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = prepareSync(process.cwd(), process.argv[2] || '')
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(result))
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
  console.log(JSON.stringify(result))
}
