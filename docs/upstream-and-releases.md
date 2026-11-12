# Upstream, changes and releases

[Documentation home](../README.md)

## Provenance

WebUI Workbench is a community-maintained GitHub fork of [open-webui/desktop](https://github.com/open-webui/desktop). It adds optional desktop services, connectors, project workspaces and website previews. Upstream history, author credits, license files and embedded Open WebUI branding are retained.

GitHub displays the relationship to `open-webui/desktop`; this is not an endorsement or an official Open WebUI distribution. The separately installed [Open WebUI runtime](https://github.com/open-webui/open-webui) is an independent upstream project with its own license.

## Change map

| Area | Upstream foundation | Fork additions |
| --- | --- | --- |
| Desktop | Electron shell, local launcher, managed WebUI/llama.cpp/Ollama services, terminal dock, settings and shortcuts | Optional connector registry and workspace lifecycle |
| Chat | Open WebUI interface, model connections, conversations and tool execution | Injection bridge for deliberately enabled connectors and per-chat workspace selection |
| File work | Open Terminal runtime and native Files panel | Scoped local processes, stale-path safeguards, workspace switching and lifecycle cleanup |
| GitHub | GitHub APIs and optional official remote MCP server | Optional CLI account adapter, cloud file browsing, verified commit writes and scoped workflow/Pages actions |
| Preview | Browser rendering | Conditional preview tab, isolated local/static repository previews |
| Distribution | Upstream source and runtime releases | Compatibility gates, fork update feed and daily merge/release automation |

Fresh profiles start without active connections. The distribution has a separate app identity, profile and update feed. Optional connectors remain available, and existing installations are not silently migrated. See the [implementation architecture](../FORK_NOTES.md) for technical boundaries.

## Automatic updates without a manual trigger

The default branch is `managed-services`; `release` builds the fork. Both receive the complete integrated upstream history. `main` retains a historical official Desktop snapshot used as an ancestry check; it is not updated by the scheduled workflow.

1. GitHub Actions is scheduled daily at **06:17 UTC**. GitHub can delay scheduled runs, sometimes substantially; this is not a precise-time guarantee.
2. It fetches official Desktop `main` and the latest stable Open WebUI runtime release.
3. It merges into a candidate and keeps fork changes. Before updating `src/shared/runtime-versions.json`, it probes the latest Open WebUI wheel with the candidate's runtime compatibility contract. An explicit compatibility mismatch defers that runtime update, retains the tested pin and records a notice in the run summary. The next sync retries the latest stable release.
4. Unit/regression tests, build and the runtime compatibility contract must pass before an atomic, non-forced push.
5. The workflow explicitly starts the release pipeline because pushes made by `GITHUB_TOKEN` do not trigger another push workflow. Users do not need to click Run workflow.
6. All required platform packaging jobs must pass before release assets and matching update manifests are published.

The atomic push updates `managed-services` and `release`. It does not also advance the auxiliary `main` snapshot: pristine upstream workflow files can require a `workflows` permission that `GITHUB_TOKEN` cannot grant itself. This does not change which Desktop source commits or Open WebUI features are integrated into the shipping branches.

Stable Open WebUI releases are selected without a minor-version ceiling. A compatible candidate adopts the complete upstream interface and features. An incompatible runtime waits until Workbench's extensions support it; the existing tested version continues to build. This is a temporary deferral, not a fixed version ceiling. Deferring an otherwise unchanged runtime does not bump the Workbench version or start repeated releases.

Only explicit upstream contract mismatches use this deferral. Network failures, dependency installation failures, merge conflicts, regressions and build failures still fail the run and prevent publication. The final compatibility gate also remains mandatory for the runtime actually being shipped. Direct pushes and pull requests to the shipping branches run verification; changes to frontend compatibility code also trigger the sync workflow.

Routine version/identity overlaps in `package.json` and `package-lock.json` use a constrained three-way merge: fork-owned identity fields stay local, independent official dependency changes are retained, and competing dependency changes fail closed. Official Desktop release notes are refreshed in [their own snapshot](desktop-upstream-changelog.md); Workbench's Changelog retains its independent version history. This handles overlapping official and fork version numbers without discarding either project's notes. Source and dependency conflicts still stop publication.

Changes to the sync workflow/scripts on the default branch also trigger verification automatically. After 45 quiet days, a no-change maintenance commit keeps public-repository scheduling active; it does not change the app version. Actions must remain enabled and permitted to write contents and dispatch workflows. No personal token or always-on desktop is required.

## Versioning and installed apps

Workbench uses its own semantic version, starting with `0.1.0`. Desktop upstream and runtime versions are independent of the Workbench release number. Tested Open WebUI and Open Terminal versions are tracked in [runtime-versions.json](../src/shared/runtime-versions.json).

An automatic upstream update increments the Workbench patch version, for example `0.1.0` to `0.1.1`, without resetting it to an upstream version. A higher version already prepared on the default branch is preserved. Invalid versions and downgrades stop publication.

The app's feed points only to `nicoegerer/webui-workbench`. Automatic desktop downloads install on normal quit, without forcing an active chat to restart. Runtime upgrades back up the local database first and respect disabled updates or explicit pins. A failed runtime upgrade is logged and the existing runtime can still start.

An upstream update notice may appear before the fork's daily check and builds finish. Do not install the original project's installer over this fork just to dismiss that notice.

## Maintenance limits

“Automatic” means no routine manual workflow triggering, not that all future changes are compatible. Known incompatible runtime updates are deferred with a visible notice. Merge conflicts, failed tests, other API changes, permission changes, disabled Actions or exhausted CI availability can still need intervention. The workflow stops rather than discarding fork changes or publishing a broken candidate.

Runtime/connector accounts are not authenticated by the public build. A passing release does not guarantee that every provider, account policy or model supports every tool. Windows CI runs extra real-HTTP and isolated-browser regressions; platform packaging is not equivalent to exhaustive manual testing on every OS.

The current pipeline follows official Desktop `main`, not only tagged desktop versions, and stable runtime releases. Read the changelog and CI results before choosing a build for important work.

## Desktop 0.1 port

Workbench 0.2 integrates the Desktop 0.1.4 architecture and subsequent upstream changes through `f09e801`. The shared process supervisor, terminal transport, local launcher, Ollama support, update state and Electron 45 are adopted. Connector registration, per-chat local/GitHub workspaces and sandboxed previews remain Workbench extensions, initialized and stopped by `src/main/services/desktop.ts`.

Open Terminal remains available under its Workbench settings tab and starts for selected project folders. Runtime updates stay pinned to the versions checked by this fork, with a database backup before an automatic WebUI upgrade. The old remote Desktop connection picker, Spotlight and standalone voice window were removed upstream; Open WebUI's own chat and voice features remain available.

Open WebUI 0.13.0 replaces the old controls sidebar with native chat tabs. Workbench adopts those tabs without resetting them when the composer workspace changes. Each Files tab keeps its own terminal and directory context; open file, editor and terminal tabs keep their workspace connections alive. The conditional Workbench **Website preview** action sits beside the corresponding Files tab and leaves Open WebUI's native preview, browser, terminal and editor features intact. Browser regressions exercise the actual components shipped in the runtime wheel.

The upstream and fork both used versions `0.1.x`. Their release notes are kept separately: this repository's Changelog records Workbench releases, and [the Desktop 0.1 notes](desktop-upstream-changelog.md) preserve the integrated upstream notes.
