# Desktop extension architecture

[Contributing](CONTRIBUTING.md) · [Connection setup](docs/services-and-connectors.md) · [Workspace behavior](docs/workspaces-and-preview.md) · [Upstream and releases](docs/upstream-and-releases.md)

## Integration boundaries

- `src/main/services/` owns connector persistence, process supervision, credentials, Open WebUI registration, GitHub access and preview servers.
- `src/shared/services/` contains transport-independent contracts, request binding, ownership rules and repository operations.
- `src/preload/services.ts` exposes the allow-listed renderer API. Main-process handlers validate requests independently of the UI.
- `src/renderer/src/lib/components/Main/Settings/Services.svelte` manages connector discovery and configuration.
- `src/renderer/src/lib/guest/` bridges the embedded Open WebUI chat, workspace selection and conditional preview tab.
- `resources/open-terminal-workspace.py` wraps the official Open Terminal runtime without modifying its installed files.

Electron startup, settings navigation and the status bar provide the entry points. New profiles have no active connectors, credentials or selected workspace. The distribution uses its own `webui-workbench` profile; it does not silently adopt another installation's data.

## Workspace lifecycle

Activation is versioned per conversation. A message waits for pending manual selection, and superseded work cannot overwrite the current chat's selection. Draft handover cannot inherit an existing conversation's workspace.

The guest bridge sets the selected terminal's per-chat working directory before dispatch. Switching terminals clears pending file-open requests and remounts the Files panel without resetting the conversation. Each request carries the current output root, independently of paths in chat history.

Local instances run in the actual selected folder. Idle chat-owned terminals can be released; active commands, PTYs and explicitly started services retain ownership. The autostart preference controls future launches, not whether a manually started service may remain alive.

The Python wrapper rejects stale absolute write targets, traversal and symlink escapes outside the selected root with a recoverable HTTP 409. Reads remain available. This is an accidental-write safeguard, **not an OS sandbox**: shell commands retain the desktop user's permissions. Its Windows compatibility shim supplies a missing standard-library binding only if the installed runtime needs it.

Cloud workspaces use a repository/branch-scoped GitHub file adapter, not a checkout or cloud shell. Writes preserve expected revisions and verify immutable committed bytes. Preview resources come from one committed tree so simultaneous writes cannot mix revisions in a page.

## Connector ownership and credentials

Local processes have no tool contract. Local stdio MCP servers use the general `mcpo` adapter; remote connectors use supported Streamable HTTP endpoints. Provider authentication remains the user's responsibility.

The main process registers enabled connectors through the managed Open WebUI server's admin API, independently of webview creation. Desktop-owned IDs distinguish automatic entries from user-managed integrations. Request binding prioritizes the active filesystem before other enabled connectors to accommodate provider tool-count limits.

Imports require review and confirmation. Exports omit managed environment values and token/key fields, but do not sanitize arbitrary secrets embedded in names, URLs or arguments. Credentials use Electron `safeStorage` where available. Processes launch without shell expansion, and process supervision only terminates instances owned by the app.

## Preview and frontend compatibility

Static previews use isolated loopback origins, scoped capabilities and sandboxed frames without the desktop IPC bridge. Generated content cannot reuse a retired origin or navigate to privileged app endpoints. Renderer requests select registered workspaces, not arbitrary disk paths.

Managed frontend patches preserve recoverable original assets and source-map positions. Guest-injected helpers must remain self-contained. Compatibility checks use the published frontend's real stores, components and dictionaries instead of assuming that internal interfaces stay stable.

## Verification

Unit tests cover ownership, credentials, request binding, file access, verified writes, previews and release metadata. Runtime-contract checks examine the pinned upstream packages; isolated Chromium tests exercise the real frontend. Windows packaging also runs the installed Open Terminal HTTP tests.

See [contributing](CONTRIBUTING.md) for commands and [release policy](docs/upstream-and-releases.md) for branch roles, scheduled integration and publication gates.
