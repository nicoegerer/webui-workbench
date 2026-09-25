import type { ManagedServiceDefinition } from './types'

/** Presets are choices, never accounts or services installed on someone's behalf. */
export const createDefaultServices = (): ManagedServiceDefinition[] => []
