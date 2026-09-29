import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createDefaultServices } from '../src/shared/services/empty-registry.ts'
import { FORK_APP_ID, FORK_PROFILE_DIRECTORY, FORK_REPOSITORY } from '../src/shared/fork-info.ts'

test('a fresh registry is empty and independent of every other profile', () => {
  const first = createDefaultServices()
  assert.deepEqual(first, [])
  assert.notEqual(first, createDefaultServices())
  const registry = readFileSync(
    new URL('../src/main/services/registry.ts', import.meta.url),
    'utf8'
  )
  assert.equal((registry.match(/services: createDefaultServices\(\)/g) ?? []).length, 2)
  assert.doesNotMatch(registry, /readLegacyAutostartEnabled|startOmniRouteAutomatically/)
  assert.match(
    registry,
    /raw\.services as PersistedService\[\]/,
    'explicitly saved services survive'
  )
})

test('new profiles contain no connections, workspace, credentials or enabled local tools', () => {
  const source = readFileSync(new URL('../src/main/utils/index.ts', import.meta.url), 'utf8')
  const literal = source.match(/const DEFAULT_CONFIG: AppConfig = (\{[\s\S]*?\n\})/)?.[1]
  assert.ok(literal)
  const config = JSON.parse(JSON.stringify(runInNewContext(`(${literal})`)))
  assert.equal(config.defaultConnectionId, null)
  assert.deepEqual(config.connections, [])
  assert.deepEqual(config.envVars, {})
  assert.deepEqual(config.workspaces, { recent: [], active: [] })
  assert.equal(config.openTerminal.enabled, false)
  assert.equal(config.llamaCpp.enabled, false)
  assert.equal(config.localServer.serveOnLocalNetwork, false)
  assert.equal(config.localServer.autoUpdate, true, 'connector defaults must not break updates')
  assert.match(source, /return structuredClone\(DEFAULT_CONFIG\)/)
})

test('the fork has its own profile, application identity and update feed', () => {
  assert.equal(FORK_PROFILE_DIRECTORY, 'webui-workbench')
  assert.equal(FORK_APP_ID, 'io.github.nicoegerer.webuiworkbench')
  assert.equal(FORK_REPOSITORY, 'https://github.com/nicoegerer/webui-workbench')
  const read = (file: string): string =>
    readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const main = read('src/main/index.ts')
  const profile = "app.setPath('userData', join(app.getPath('appData'), FORK_PROFILE_DIRECTORY))"
  assert.ok(main.includes(profile))
  assert.ok(main.indexOf(profile) < main.indexOf('const gpuCrashMarkerPath'))
  assert.doesNotMatch(main, /app\.name = 'Open WebUI'/)
  for (const file of ['electron-builder.yml', 'dev-app-update.yml']) {
    assert.match(read(file), /repo: webui-workbench/)
    assert.doesNotMatch(read(file), /repo: desktop\s/)
  }
})

import {
  migrateOmniRouteDefaults,
  OMNIROUTE_HEALTH_CHECK_URL,
  OMNIROUTE_STARTUP_TIMEOUT_MS
} from '../src/shared/services/omniroute-defaults.ts'

test('OmniRoute uses a lightweight readiness endpoint and a cold-start-safe timeout', () => {
  assert.equal(OMNIROUTE_HEALTH_CHECK_URL, 'http://127.0.0.1:20128/api/health/ping')
  assert.equal(OMNIROUTE_STARTUP_TIMEOUT_MS, 300_000)
})

test('persisted OmniRoute defaults are upgraded without changing other settings', () => {
  const persisted = {
    id: 'omniroute',
    enabled: false,
    healthCheckUrl: 'http://127.0.0.1:20128/api/monitoring/health',
    startupTimeoutMs: 120_000
  }

  const migrated = migrateOmniRouteDefaults(persisted)

  assert.equal(migrated.enabled, false)
  assert.equal(migrated.healthCheckUrl, OMNIROUTE_HEALTH_CHECK_URL)
  assert.equal(migrated.startupTimeoutMs, OMNIROUTE_STARTUP_TIMEOUT_MS)
})

test('a custom OmniRoute health URL is preserved while unsafe timeouts are raised', () => {
  const migrated = migrateOmniRouteDefaults({
    id: 'omniroute',
    healthCheckUrl: 'http://127.0.0.1:30128/ready',
    startupTimeoutMs: 45_000
  })

  assert.equal(migrated.healthCheckUrl, 'http://127.0.0.1:30128/ready')
  assert.equal(migrated.startupTimeoutMs, OMNIROUTE_STARTUP_TIMEOUT_MS)
})

test('non-OmniRoute services are not modified', () => {
  const service = {
    id: 'custom',
    healthCheckUrl: 'http://127.0.0.1:9000/health',
    startupTimeoutMs: 30_000
  }

  assert.equal(migrateOmniRouteDefaults(service), service)
})
