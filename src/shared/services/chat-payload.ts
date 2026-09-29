/** Bind each request to its selected workspace and enabled desktop connectors.
* Injected via Function.toString(): keep the function self-contained, without imports or outer references. */

export interface ChatWorkspaceSelection {
  mode: 'local' | 'cloud'
  /** Open WebUI terminal id of the local workspace, when mode is 'local'. */
  terminalId?: string
  /** Authoritative root for this turn; earlier chat paths are historical. */
  path?: string
  /** Repository worked on without a checkout, when mode is 'cloud'. */
  repoFullName?: string
  branch?: string
}

export interface ChatPayloadPatch {
  selection: ChatWorkspaceSelection | null
  /** Tool ids of desktop connectors that must be active in every chat. */
  alwaysOnToolIds: string[]
}

export const CLOUD_INSTRUCTION_MARKER = '[desktop-cloud-workspace]'

export function applyWorkspaceToPayload(
  body: Record<string, unknown>,
  patch: ChatPayloadPatch
): Record<string, unknown> {
  if (!body || typeof body !== 'object') return body

  const next: Record<string, unknown> = { ...body }
  const marker = '[desktop-cloud-workspace]'
  const localMarker = '[desktop-local-workspace]'
  const selection = patch ? patch.selection : null

  if (selection && next.model_item && typeof next.model_item === 'object') {
    const modelItem = next.model_item as Record<string, unknown>
    const info =
      modelItem.info && typeof modelItem.info === 'object'
        ? (modelItem.info as Record<string, unknown>)
        : {}
    const meta =
      info.meta && typeof info.meta === 'object' ? (info.meta as Record<string, unknown>) : {}
    const capabilities =
      meta.capabilities && typeof meta.capabilities === 'object'
        ? (meta.capabilities as Record<string, unknown>)
        : {}
    next.model_item = {
      ...modelItem,
      info: { ...info, meta: { ...meta, capabilities: { ...capabilities, terminal: true } } }
    }
  }

  const existingToolIds = Array.isArray(next.tool_ids) ? (next.tool_ids as string[]) : []
  const alwaysOn = Array.isArray(patch?.alwaysOnToolIds) ? patch.alwaysOnToolIds : []
  // Providers can truncate tools in server order: prioritize the selected filesystem.
  // Remove other workspace ids so switching cannot retain access to a stale folder.
  const toolIds: string[] = []
  if (selection?.terminalId) {
    toolIds.push(`server:desktop-workspace-${selection.terminalId}`)
  }
  // Two compact GitHub tools must survive providers' tool-count limits, too.
  for (const id of alwaysOn) {
    if (
      typeof id === 'string' &&
      id.startsWith('server:desktop-github-cli-') &&
      !toolIds.includes(id)
    )
      toolIds.push(id)
  }
  for (const id of [...existingToolIds, ...alwaysOn]) {
    if (typeof id !== 'string' || !id || id.startsWith('server:desktop-workspace-')) continue
    if (toolIds.indexOf(id) === -1) toolIds.push(id)
  }
  if (toolIds.length > 0 || Array.isArray(next.tool_ids)) next.tool_ids = toolIds

  // Replace the turn-scoped instruction rather than stacking roots across workspace changes.
  const messages = Array.isArray(next.messages)
    ? (next.messages as Array<Record<string, unknown>>)
    : null
  const cleaned = messages
    ? messages.filter(
        (message) =>
          !(
            message &&
            message.role === 'system' &&
            typeof message.content === 'string' &&
            (message.content.indexOf(marker) !== -1 || message.content.indexOf(localMarker) !== -1)
          )
      )
    : null

  if (!selection) {
    if (typeof next.terminal_id === 'string' && /^desktop-(ws|gh)-/.test(next.terminal_id)) {
      delete next.terminal_id
    }
    if (cleaned) next.messages = cleaned
    return next
  }

  if (selection.mode === 'local') {
    if (selection.terminalId) next.terminal_id = selection.terminalId
    if (cleaned) {
      const instruction =
        localMarker +
        ' A local workspace is active through Open Terminal' +
        (selection.path ? ' at ' + JSON.stringify(selection.path) : '') +
        '. This is the CURRENT workspace for THIS turn, even if earlier messages or tool results name another folder.' +
        ' A workspace switch does not require a new chat. Treat earlier output paths as history, not as the current destination.' +
        ' Create new files and variants under this current workspace; do not reuse an absolute output path from an earlier turn.' +
        ' Use paths relative to this workspace or absolute paths inside it. Read earlier source files only when needed;' +
        ' file mutations outside it are rejected. To modify another folder, ask the user to select that workspace first' +
        '. Use the file tools to inspect, create and modify files directly in this workspace.' +
        ' Prefer write_file/replace_file_content over shell quoting, and verify the result with read_file.' +
        ' When asked to build or edit something, save the files, not just a code block for copying.' +
        ' Report the actual paths and tool errors honestly; never claim a write succeeded without verification.'
      const systemIndex = cleaned.findIndex((message) => message && message.role === 'system')
      const entry = { role: 'system', content: instruction }
      next.messages =
        systemIndex === -1
          ? [entry, ...cleaned]
          : [...cleaned.slice(0, systemIndex + 1), entry, ...cleaned.slice(systemIndex + 1)]
    }
    return next
  }

  if (selection.terminalId) next.terminal_id = selection.terminalId
  else delete next.terminal_id
  if (cleaned) {
    const instruction =
      marker +
      ' The active workspace is the GitHub repository `' +
      String(selection.repoFullName ?? '') +
      '` on branch `' +
      String(selection.branch ?? '') +
      '`. This is the CURRENT workspace for THIS turn; earlier paths and repositories are historical.' +
      ' Use list_files/read_file to inspect it and write_file to create or replace files directly on this branch.' +
      ' Each write_file creates a GitHub commit and verifies its contents. When asked to create files, save them' +
      ' with these tools instead of giving only code to copy. Use repository-relative paths, not Windows paths.' +
      ' Verify with read_file and report the actual repository, path, branch and commit. Report permission or' +
      ' conflict errors honestly; never claim a write succeeded without verification.' +
      ' There is no local checkout or shell. Do not switch to another local folder. Broader GitHub tools remain' +
      ' available for explicitly requested repository operations.' +
      ' When github_api_read and github_actions_logs are available, use them to inspect Actions runs, failed logs and Pages status.' +
      ' A file commit or workflow edit is not evidence of a successful build or deployment; verify the actual run conclusion.' +
      ' For explicitly requested deployment, github_workspace_action can enable Pages and dispatch/rerun workflows only in this selected repository branch.' +
      ' These actions can publish a website. Do not call them for a status question or mere file edit; never treat an accepted run as completed.'

    const systemIndex = cleaned.findIndex((message) => message && message.role === 'system')
    const entry = { role: 'system', content: instruction }
    next.messages =
      systemIndex === -1
        ? [entry, ...cleaned]
        : [...cleaned.slice(0, systemIndex + 1), entry, ...cleaned.slice(systemIndex + 1)]
  }
  return next
}
