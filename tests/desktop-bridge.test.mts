import assert from 'node:assert/strict'
import test from 'node:test'
import { handleGuestRequest } from '../src/renderer/src/lib/guest-requests.ts'

test('the new guest bridge retains the Workbench workspace capabilities', async () => {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const api = new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          calls.push({ name, args })
          return Promise.resolve({ ok: true })
        }
    }
  ) as Parameters<typeof handleGuestRequest>[0]
  for (const request of [
    { type: 'workspaceChooseFolder' },
    { type: 'workspaceRecent' },
    { type: 'workspaceListRepos' },
    { type: 'workspaceOpenLocal', path: '/fixture/project' },
    { type: 'workspaceEnsure', terminalId: 'desktop-ws-fixture' },
    { type: 'workspaceKeepAlive', ids: ['desktop-ws-fixture'] },
    { type: 'workspaceMountRepo', repoFullName: 'example/site', branch: 'feature/site' },
    { type: 'workspacePreviewInspect', terminalId: 'desktop-ws-fixture' },
    { type: 'workspacePreviewOpen', terminalId: 'desktop-ws-fixture', entryPath: 'index.html' },
    { type: 'workspacePreviewClose', id: 'preview-fixture' },
    { type: 'syncOpenWebUI' }
  ]) {
    assert.deepEqual(await handleGuestRequest(api, request), { ok: true })
    assert.equal(calls.at(-1)?.name, request.type)
  }
  assert.deepEqual(calls.find((call) => call.name === 'workspaceMountRepo')?.args, [
    { repoFullName: 'example/site', branch: 'feature/site' }
  ])
  await handleGuestRequest(api, { type: 'token:update', token: 'fixture-only' })
  assert.deepEqual(calls.at(-1), { name: 'setAuthToken', args: ['fixture-only'] })
})

test('embedded WebUI cannot invoke arbitrary desktop APIs through the new dispatcher', async () => {
  let called = false
  const api = new Proxy(
    {},
    {
      get: () => () => {
        called = true
      }
    }
  ) as Parameters<typeof handleGuestRequest>[0]
  for (const type of ['setConfig', 'openPath', 'resetApp', 'startServer', 'saveManagedService']) {
    await assert.rejects(handleGuestRequest(api, { type }), /Unsupported desktop request/)
  }
  await assert.rejects(
    handleGuestRequest(api, { type: 'openInBrowser', url: 'javascript:alert(1)' }),
    /Invalid URL/
  )
  await assert.rejects(
    handleGuestRequest(api, { type: 'token:update', token: {} }),
    /Invalid token/
  )
  assert.equal(called, false)
})
