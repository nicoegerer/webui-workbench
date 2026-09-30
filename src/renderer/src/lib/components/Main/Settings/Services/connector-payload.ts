import type { ManagedServiceDefinition } from '../../../../../../../shared/services/types'

export function changeConnectorType(
  draft: ManagedServiceDefinition,
  type: ManagedServiceDefinition['type'],
  argsText: string,
  port = 0
): ManagedServiceDefinition {
  if (type === draft.type) return draft
  const command = draft.type === 'mcpo' ? (draft.mcpo?.serverCommand ?? '') : draft.command
  const args = argsText.split(/\r?\n/).filter(Boolean)
  return {
    ...draft,
    type,
    command: type === 'generic' ? command : '',
    args: type === 'generic' ? args : [],
    // A proxy's health endpoint must not survive switching to its underlying process.
    healthCheckUrl: undefined,
    mcpo:
      type === 'mcpo'
        ? { serverCommand: command, serverArgs: args, port, runnerCommand: 'uvx' }
        : undefined,
    remote: type === 'remote' ? { url: '' } : undefined,
    apiKey: type === 'mcpo' ? '' : undefined,
    accessToken: type === 'remote' ? '' : undefined
  }
}

/** Rebuild only edited fields; hidden advanced settings and secrets survive. */
export function connectorPayload(
  draft: ManagedServiceDefinition,
  argsText: string,
  entries: ReadonlyArray<{ key: string; value: string }>
): Omit<ManagedServiceDefinition, 'id'> & { id?: string } {
  const args = argsText.split(/\r?\n/).filter((entry) => entry.length > 0)
  const env = Object.fromEntries(
    entries.filter((entry) => entry.key.trim()).map((entry) => [entry.key.trim(), entry.value])
  )
  return {
    ...draft,
    id: draft.id || undefined,
    name: draft.name.trim(),
    env,
    ...(draft.type === 'generic'
      ? { args, mcpo: undefined, remote: undefined, accessToken: undefined }
      : draft.type === 'mcpo'
        ? {
            apiKey: draft.id ? draft.apiKey : '',
            mcpo: { ...draft.mcpo!, serverArgs: args },
            remote: undefined,
            accessToken: undefined
          }
        : {
            command: '',
            args: [],
            mcpo: undefined,
            remote: { ...draft.remote!, url: draft.remote!.url.trim() }
          })
  }
}
