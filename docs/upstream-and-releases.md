# Upstream, changes and releases

[Documentation home](../README.md)

## Provenance

WebUI Workbench is an unofficial fork of [open-webui/desktop](https://github.com/open-webui/desktop), carried forward from [nicoegerer/desktop](https://github.com/nicoegerer/desktop). The public starting point is the Services .38 history, commit `8f91a4bfbbffe21109b49cac8258b385093675df`. History, upstream author credits, license files and embedded Open WebUI branding are retained.

The repository was created as a history-preserving copy outside GitHub's fork network. That changes the GitHub badge, not the source's provenance. The separately installed [Open WebUI runtime](https://github.com/open-webui/open-webui) is an independent upstream project with its own license.

## Change map

| Area | Upstream foundation | Fork additions |
| --- | --- | --- |
| Desktop | Electron shell, installer/runtime management, server connections, settings and shortcuts | Optional service registry, process management and connector hub |
| Chat | Open WebUI interface, model connections, conversations and tool execution | Injection bridge for deliberately enabled connectors and per-chat workspace selection |
| File work | Open Terminal runtime and native Files panel | Scoped local processes, stale-path safeguards, workspace switching and lifecycle cleanup |
| GitHub | GitHub APIs and optional official remote MCP server | Optional CLI account adapter, cloud file browsing, verified commit writes and scoped workflow/Pages actions |
| Preview | Browser rendering | Conditional preview tab, isolated local/static repository previews |
| Distribution | Upstream source and runtime releases | Compatibility gates, fork update feed and daily merge/release automation |

This release adds neutral first-run behavior (including removal of legacy OmniRoute auto-creation), a separate app profile/identity, corrected download/support links and public setup/security documentation. It does not remove the optional connectors or silently migrate existing installations.

## Automatic updates without a manual trigger

The default branch is `managed-services` (historical name). `main` mirrors official Desktop; `release` builds the fork.

1. GitHub Actions checks daily at **06:17 UTC**; runs can be delayed by GitHub.
2. It fetches official Desktop `main` and the latest stable Open WebUI runtime release.
3. It merges into a candidate, keeps fork changes and updates `src/shared/runtime-versions.json` when needed.
4. Unit/regression tests, build and the runtime compatibility contract must pass before an atomic, non-forced push.
5. The workflow explicitly starts the release pipeline because pushes made by `GITHUB_TOKEN` do not trigger another push workflow. Users do not need to click Run workflow.
6. All required platform packaging jobs must pass before release assets and matching update manifests are published.

Changes to the sync workflow/scripts on the default branch also trigger verification automatically. After 45 quiet days, a no-change maintenance commit keeps public-repository scheduling active; it does not change the app version. Actions must remain enabled and permitted to write contents and dispatch workflows. No personal token or always-on desktop is required.

## Versioning and installed apps

`0.0.20-workbench.1` means official Desktop base `0.0.20` plus fork iteration 1. The runtime version is tracked separately; this starting release targets Open WebUI **0.11.4** and Open Terminal **0.11.34**. A newer Desktop base resets the fork counter; otherwise it increases monotonically.

The app's feed points only to `nicoegerer/webui-workbench`. Automatic desktop downloads install on normal quit, without forcing an active chat to restart. Runtime upgrades back up the local database first and respect disabled updates or explicit pins. A failed runtime upgrade is logged and the existing runtime can still start.

An upstream update notice may appear before the fork's daily check and builds finish. Do not install the original project's installer over this fork just to dismiss that notice.

## Maintenance limits

“Automatic” means no routine manual workflow triggering, not that all future changes are compatible. Merge conflicts, failed tests, API changes, permission changes, disabled Actions or exhausted CI availability need intervention. The workflow stops rather than discarding fork changes or publishing a broken candidate.

Runtime/connector accounts are not authenticated by the public build. A passing release does not guarantee that every provider, account policy or model supports every tool. Windows CI runs extra real-HTTP and isolated-browser regressions; platform packaging is not equivalent to exhaustive manual testing on every OS.

The current pipeline follows official Desktop `main`, not only tagged desktop versions, and stable runtime releases. Read the changelog and CI results before choosing a build for important work.
