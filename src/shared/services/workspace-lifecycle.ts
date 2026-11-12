/** Native 0.13 tabs own workspaces independently of the composer selection.
 * Opaque tab IDs include terminals and untitled editors; retain known instances
 * until those tabs close rather than discarding an unsaved buffer's connection.
 * Injected with toString(): keep this function self-contained.
 */
export function nativeTabWorkspaceLeases(tabIds: string[], registeredIds: string[]): string[] {
  const keep = new Set<string>()
  const managed = (id: unknown): id is string =>
    typeof id === 'string' && /^desktop-(ws|gh)-/.test(id)
  for (const id of tabIds) {
    if (id.startsWith('files:')) {
      if (managed(id.slice(6))) keep.add(id.slice(6))
      continue
    }
    if (['chat', 'main-chat', 'artifacts', 'preview', 'voice', 'comments'].includes(id)) continue
    try {
      const parts = JSON.parse(id)
      if (Array.isArray(parts) && ['file', 'browser', 'desktop'].includes(parts[0])) {
        if (managed(parts[1])) keep.add(parts[1])
        continue
      }
    } catch {
      /* A native terminal, side chat or untitled file has an opaque UUID. */
    }
    for (const registered of registeredIds) if (managed(registered)) keep.add(registered)
  }
  return [...keep]
}

/** Keep current/pending workspaces and active background chats, not every old chat forever.
 * Injected into the guest as text: this function must remain self-contained.
 */
export async function resolveWorkspaceKeepIds(options: {
  selections: Record<string, { terminalId?: string } | null>
  currentKey: string
  extraId?: string
  registeredIds: string[]
  leasedIds?: string[]
  requests?: Array<{ chatId: string; terminalId: string }>
  hasRunningChat: (chatId: string) => Promise<boolean | null>
}): Promise<string[]> {
  const keep = new Set<string>()
  for (const id of [
    options.selections[options.currentKey]?.terminalId,
    options.extraId,
    ...(options.leasedIds ?? [])
  ]) {
    if (typeof id === 'string' && id) keep.add(id)
  }
  const registered = new Set(options.registeredIds)
  const groups = new Map<string, string[]>()
  // A chat's selection can change while an earlier turn still uses its old
  // terminal. Track the request binding separately from the current selection.
  for (const request of options.requests ?? []) {
    if (!request.terminalId || !registered.has(request.terminalId) || keep.has(request.terminalId))
      continue
    if (request.chatId === 'draft' || request.chatId === 'new') {
      keep.add(request.terminalId) // unknown chat identity must not interrupt work
    } else {
      groups.set(request.terminalId, [...(groups.get(request.terminalId) ?? []), request.chatId])
    }
  }
  for (const [chat, selection] of Object.entries(options.selections)) {
    const id = selection?.terminalId
    if (!id || keep.has(id) || !registered.has(id)) continue
    groups.set(id, [...(groups.get(id) ?? []), chat])
  }
  let queried = 0
  for (const [id, chats] of groups) {
    for (const chat of chats) {
      if (chat === 'draft' || chat === 'new') continue
      // Unknown states are retained. Bound inspection for very large histories.
      if (++queried > 40) {
        keep.add(id)
        break
      }
      let active: boolean | null = null
      try {
        active = await options.hasRunningChat(chat)
      } catch {
        /* retain on failure */
      }
      if (active !== false) {
        keep.add(id)
        break
      }
    }
  }
  return [...keep]
}

/** Idle chat does not imply idle shell: preserve commands, dev servers and PTYs. */
export async function canReleaseWorkspaceTerminal(
  request: (path: string) => Promise<Response>,
  isRetained: () => boolean = () => false
): Promise<boolean> {
  if (isRetained()) return false
  try {
    const [commands, terminals] = await Promise.all([
      request('/execute'),
      request('/api/terminals')
    ])
    if (!commands.ok || !terminals.ok) return false
    const processes = await commands.json()
    const sessions = await terminals.json()
    return (
      !isRetained() &&
      Array.isArray(processes) &&
      Array.isArray(sessions) &&
      sessions.length === 0 &&
      processes.every(
        (process) => process && (process.status === 'done' || process.status === 'killed')
      )
    )
  } catch {
    return false
  }
}
