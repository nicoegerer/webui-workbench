# Contributing

This repository maintains a community fork of Open WebUI Desktop. Keep changes focused and preserve upstream authorship, required notices and embedded branding.

## Development

Use Node.js 22, npm and Git:

```sh
npm ci
npm run test:ipc
npm run build
npm run dev
```

The lockfile is authoritative. Electron's native `node-pty` dependency requires a platform toolchain. On Windows, install Visual Studio C++ build tools, a Windows SDK and the required Spectre-mitigated libraries if MSBuild reports MSB8040. Do not disable native safety options just to bypass a failed build.

A full build includes TypeScript, Svelte checks, Vite compilation and the built-workspace contract check. Run focused lint on changed files; inherited upstream lint debt must be distinguished from new regressions. See the [desktop extension architecture](FORK_NOTES.md) for module boundaries and safety contracts.

## Runtime and integration checks

```sh
python .github/scripts/check-runtime-contract.py
python -B tests/test_workspace_write_guard.py --real --real-http -v
```

The second command requires the pinned Open Terminal runtime in your test Python environment. Use disposable data and no production credentials. Windows CI also exercises preview and workspace switching in an isolated headless browser. Those tests do not sign in to personal provider accounts.

## Branches and releases

- `main`: unchanged official Desktop mirror.
- `managed-services`: default branch containing this fork.
- `release`: the tested packaging branch.

Target contributions at `managed-services`. Coordinate release/default branch updates; do not force-push mirrored history. The daily sync merges both histories and verifies candidates before publication. See [release policy](docs/upstream-and-releases.md).

## Pull requests

Explain the user-visible change, permissions/data implications, tests and limitations. Add regression tests for defaults, path/branch scoping, connector lifecycle and compatibility surfaces. Never include personal profiles, real credentials, chat databases or health data.

Fork changes remain under the repository's AGPL-3.0 license. The inherited `CONTRIBUTOR_LICENSE_AGREEMENT` is retained as an upstream historical document; its presence is not a request to grant this fork's maintainer a new proprietary license. Upstream submissions follow upstream's contribution process.

Before sharing screenshots/logs, remove account identifiers, private repo names, absolute personal paths and tokens.

## Documentation and comments

Keep setup guidance organized by task in the general connection and workspace guides. Link to provider-maintained installation and authentication instructions instead of duplicating them. Update incoming links when moving or removing a page.

Use comments for security boundaries, non-obvious invariants and platform constraints. Keep compiler/linter directives and required notices. Do not annotate code with change history, commit references, commented-out implementations or descriptions that merely repeat the next statement; use Git history and the changelog for changes.

Present WebUI Workbench as a community-maintained Open WebUI Desktop fork, not an official or endorsed product. Preserve upstream branding and attribution, keep download/support links on this repository, and distinguish templates from active connections, endpoint reachability from working tools, and workflow dispatch from successful deployment. Do not claim sandboxing, universal provider support or maintenance-free updates.
