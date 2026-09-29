import {
  MCPO_API_KEY_PLACEHOLDER,
  type ManagedServiceDefinition
} from '../../shared/services/types'
const createMcpoArgs = (
  host: string,
  port: number,
  serverCommand: string,
  serverArgs: string[]
): string[] => [
  '--refresh',
  '--with',
  'mcp==1.9.4',
  'mcpo',
  '--host',
  host,
  '--port',
  String(port),
  '--api-key',
  MCPO_API_KEY_PLACEHOLDER,
  '--',
  serverCommand,
  ...serverArgs
]

export const materializeMcpoService = (
  service: ManagedServiceDefinition
): ManagedServiceDefinition => {
  if (service.type !== 'mcpo' || !service.mcpo) return service

  const host = '127.0.0.1'
  return {
    ...service,
    command: service.mcpo.runnerCommand?.trim() || 'uvx',
    args: createMcpoArgs(
      host,
      service.mcpo.port,
      service.mcpo.serverCommand,
      service.mcpo.serverArgs
    ),
    healthCheckUrl: `http://${host}:${service.mcpo.port}/docs`
  }
}
