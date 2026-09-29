# Upstream, changes and releases

[Documentation home](../README.md)

## Provenance

WebUI Workbench is a community-maintained GitHub fork of [open-webui/desktop](https://github.com/open-webui/desktop). It adds optional desktop services, connectors, project workspaces and website previews. Upstream history, author credits, license files and embedded Open WebUI branding are retained.

GitHub displays the relationship to `open-webui/desktop`; this is not an endorsement or an official Open WebUI distribution. The separately installed [Open WebUI runtime](https://github.com/open-webui/open-webui) is an independent upstream project with its own license.

## Change map

| Area | Upstream foundation | Fork additions |
| --- | --- | --- |
| Desktop | Electron shell, installer/runtime management, server connections, settings and shortcuts | Optional service registry, process management and connector hub |
| Chat | Open WebUI interface, model connections, conversations and tool execution | Injection bridge for deliberately enabled connectors and per-chat workspace selection |
| File work | Open Terminal runtime and native Files panel | Scoped local processes, stale-path safeguards, workspace switching and lifecycle cleanup |
| GitHub | GitHub APIs and optional official remote MCP server | Optional CLI account adapter, cloud file browsing, verified commit writes and scoped workflow/Pages actions |
| Preview | Browser rendering | Conditional preview tab, isolated local/static repository previews |
| Distribution | Upstream source and runtime releases | Compatibility gates, fork update feed and daily merge/release automation |

Fresh profiles start without active connections. The distribution has a separate app identity, profile and update feed. Optional connectors remain available, and existing installations are not silently migrated. See the [implementation architecture](../FORK_NOTES.md) for technical boundaries.

## Automatic updates without a manual trigger

The default branch is `managed-services`. `main` mirrors official Desktop; `release` builds the fork.

1. GitHub Actions is scheduled daily at **06:17 UTC**. GitHub can delay scheduled runs, sometimes substantially; this is not a precise-time guarantee.
2. It fetches official Desktop `main` and the latest stable Open WebUI runtime release.
3. It merges into a candidate, keeps fork changes and updates `src/shared/runtime-versions.json` when needed.
4. Unit/regression tests, build and the runtime compatibility contract must pass before an atomic, non-forced push.
5. The workflow explicitly starts the release pipeline because pushes made by `GITHUB_TOKEN` do not trigger another push workflow. Users do not need to click Run workflow.
6. All required platform packaging jobs must pass before release assets and matching update manifests are published.

Routine version/identity overlaps in `package.json` and `package-lock.json` use a constrained three-way merge: fork-owned identity fields stay local, independent official dependency changes are retained, and competing dependency changes fail closed. New Changelog sections are combined only when the existing history and preamble are unchanged. This avoids asking the maintainer to resolve an ordinary version bump without silently preferring fork dependencies or discarding upstream notes.

Changes to the sync workflow/scripts on the default branch also trigger verification automatically. After 45 quiet days, a no-change maintenance commit keeps public-repository scheduling active; it does not change the app version. Actions must remain enabled and permitted to write contents and dispatch workflows. No personal token or always-on desktop is required.

## Versioning and installed apps

Workbench uses its own semantic version, starting with `0.1.0`. Desktop upstream and runtime versions are independent of the Workbench release number. Tested Open WebUI and Open Terminal versions are tracked in [runtime-versions.json](../src/shared/runtime-versions.json).

An automatic upstream update increments the Workbench patch version, for example `0.1.0` to `0.1.1`, without resetting it to an upstream version. A higher version already prepared on the default branch is preserved. Invalid versions and downgrades stop publication.

The app's feed points only to `nicoegerer/webui-workbench`. Automatic desktop downloads install on normal quit, without forcing an active chat to restart. Runtime upgrades back up the local database first and respect disabled updates or explicit pins. A failed runtime upgrade is logged and the existing runtime can still start.

An upstream update notice may appear before the fork's daily check and builds finish. Do not install the original project's installer over this fork just to dismiss that notice.

## Maintenance limits

“Automatic” means no routine manual workflow triggering, not that all future changes are compatible. Merge conflicts, failed tests, API changes, permission changes, disabled Actions or exhausted CI availability need intervention. The workflow stops rather than discarding fork changes or publishing a broken candidate.

Runtime/connector accounts are not authenticated by the public build. A passing release does not guarantee that every provider, account policy or model supports every tool. Windows CI runs extra real-HTTP and isolated-browser regressions; platform packaging is not equivalent to exhaustive manual testing on every OS.

The current pipeline follows official Desktop `main`, not only tagged desktop versions, and stable runtime releases. Read the changelog and CI results before choosing a build for important work.
