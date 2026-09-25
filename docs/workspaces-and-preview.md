# Workspaces and website preview

[Documentation home](../README.md)

A workspace is an explicit, per-conversation selection next to the message box. Selecting one grants the available workspace tools to a tool-capable model. No folder or repository is preselected.

## Local folder

Choose **Local → Open folder**. The actual path you select is used; the fork does not copy the project into a special workspace directory. The managed Open Terminal runtime supplies file and command tools.

The model can create files, edit code and run builds. File-mutation guards reject stale paths outside the selected workspace, traversal and symlink escapes. **This is not a shell sandbox:** commands run as your desktop user and can access more than that directory. Use trusted projects and review model actions.

## GitHub repository

Configure [GitHub access](integrations/github.md), choose **Cloud**, and select the repository/branch. There is no automatic clone, local shell or hosted execution environment.

Text writes up to the supported 1 MB UTF-8 limit create commits on that branch. The writer checks revisions and verifies committed bytes; protected branches, access limits and concurrent changes can reject writes. An empty repository is supported when your account can create its first commit.

Cloud “terminal” identifiers are internal browsing adapters, not shell sessions. Build a framework project locally or through a deliberately configured CI workflow; do not expect cloud file tools to run npm.

## Switching folders in the same chat

You do not need a new chat. Select the new workspace, wait for activation and verify the Files breadcrumb before submitting the next request. An already-running response may still belong to the workspace used when it was submitted; switching is not a cancellation mechanism.

The next request uses the new selection. Old paths quoted in conversation history do not change the current output root. Inactive workspace processes are cleaned up conservatively; active commands are not killed just because another chat is visible.

## Preview

The conditional **Preview / Vorschau** tab appears beside **Controls / Steuerung** and **Files / Dateien** when a supported preview target is available.

- **Local static site:** open a supported HTML entry point with its relative assets.
- **Local framework project:** build static output first, then select its HTML entry point. The Preview tab is not a proxy for an arbitrary development server; use your browser for a running development server.
- **Cloud static site:** preview committed HTML and assets through the authenticated repository bridge.
- **Cloud framework source:** JSX, Astro, Vue or similar source alone is not a built website. Produce static output first or use local development. Preview is not a deployment to GitHub Pages.

Changing the workspace invalidates the previous preview. Relative assets must exist and use the expected path/case. Server-side applications and arbitrary private backend APIs cannot be represented by a static repository preview.

Generated pages run without the desktop IPC bridge. The preview blocks external connections, forms and embedded frames; bundle assets locally instead of depending on a CDN. These restrictions do not make untrusted code generally safe outside the preview.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Files from an old folder | Current chat, selected chip, activation result and Files breadcrumb |
| Model prints code only | Real tool availability, provider tool support, enabled workspace |
| GitHub 404 | Account/token access, repo and branch; private repos may conceal permission failures |
| Preview tab missing | Supported HTML entry point/build output in the selected workspace |
| Preview asset missing | Commit/save the referenced asset and check relative paths |
| Actions dispatch accepted but no website | Inspect the actual Actions run/logs and Pages configuration |

For a reproducible report, use a disposable repository/folder and redact personal paths and tokens.
