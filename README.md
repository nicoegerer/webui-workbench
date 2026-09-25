# WebUI Workbench

**An unofficial [Open WebUI Desktop](https://github.com/open-webui/desktop) fork — not a separate replacement for Open WebUI.**

Optional connectors, local and GitHub workspaces, and website previews in the familiar Open WebUI interface. Open WebUI and its contributors provide the foundation; this repository documents and maintains the desktop additions. It is not affiliated with or endorsed by Open WebUI, GitHub, Garmin, or the connector providers.

[Get started](docs/getting-started.md) · [Deutsch](README.de.md) · [Downloads](https://github.com/nicoegerer/webui-workbench/releases) · [What changed](docs/upstream-and-releases.md) · [Support](SUPPORT.md)

## Start empty. Connect what you choose.

A fresh installation has **no saved connections, MCP servers, provider accounts, API keys, model gateways, or selected workspaces**. GitHub, OmniRoute and Garmin are examples you can set up, not services everyone is required to use. Discover cards are templates, not active connections.

The connector manager, filesystem tools and preview features remain available. A connector becomes available to chats only after you deliberately add and enable it. Enabled desktop connectors are then available across chats; pause or remove them in the desktop's **Settings → Services & Connectors → Yours**.

## What this fork adds

| Capability | What you can do | Important boundary |
| --- | --- | --- |
| Services & Connectors | Manage optional local processes, local MCP adapters and remote MCP endpoints | You install/authenticate providers and choose which to enable |
| Local workspaces | Select your real project folder; let a tool-capable model read, write and run commands | Commands run with your OS account's permissions, not in a sandbox |
| GitHub workspaces | Browse repositories and read/write text files in a selected branch | Writes create commits; this is not a hosted shell or Codespace |
| Website preview | View supported static HTML sites beside the chat | Build framework output first; no development-server proxy or cloud build service |
| Update integration | Automatically test and merge official upstream changes, then build fork updates | Conflicts or failed checks stop publication and need maintenance |

Chat, models, notes, voice features and the underlying web interface come from upstream. See the [change map and release policy](docs/upstream-and-releases.md) for the distinction and known limitations.

## Install

Use **this repository's [Releases page](https://github.com/nicoegerer/webui-workbench/releases)**, not the original desktop download page. Choose the asset for your OS and architecture:

- Windows: `webui-workbench-x64-setup.exe` or `webui-workbench-arm64-setup.exe`.
- macOS: the matching `webui-workbench-…dmg` (Apple Silicon: arm64; Intel: x64).
- Linux: the matching AppImage or deb. Other formats are available only when that release produced them.

Until the first release finishes, use the source instructions below. Builds without configured signing credentials are unsigned; OS warnings do not constitute a security review. Verify the repository and release you intended to install.

This distribution has a separate application ID, profile directory and update feed. It does **not** automatically import your old Open WebUI Desktop chats or connections. Your previous installation remains separate. Avoid starting two local backends on the same port.

## First chat

1. Launch the app and choose to install a local Open WebUI runtime or connect to your own instance.
2. Configure a model provider in Open WebUI; a model subscription/key is not included.
3. Send a simple chat message before adding optional tools.
4. Add only the connectors you need. For local or cloud file work, select a workspace next to the message box.

[Complete first-run guide](docs/getting-started.md)

## Optional setup guides

- [GitHub: CLI login or Personal Access Token](docs/integrations/github.md)
- [OmniRoute: use it as a model gateway](docs/integrations/omniroute.md)
- [Garmin: connect your own third-party MCP server](docs/integrations/garmin.md)
- [Other local/remote MCP servers, including Google services](docs/services-and-connectors.md)
- [Workspaces and website preview](docs/workspaces-and-preview.md)

## Updates

Installed builds check this fork's feed, download available updates and install on normal quit; they do not force a restart. The local backend follows the runtime version tested with the desktop release when its automatic-update setting is enabled. No repeated source ZIP downloads are needed.

The repository checks official Desktop commits and stable Open WebUI runtime releases daily. Automatic merging is **not a guarantee that future incompatible changes can repair themselves**. See [how updates work](docs/upstream-and-releases.md).

## Data and permissions

Remote models receive the content you send them, including tool results. Enabled connectors can access their configured accounts; local commands can affect your computer. This is not an offline-only product or a sandbox. Read [privacy and security](SECURITY.md) before granting access, importing a connector, or working with sensitive projects.

## Build from source

Requires Git, Node.js 22 and npm. Native dependencies also require your platform's build toolchain.

```sh
git clone https://github.com/nicoegerer/webui-workbench.git
cd webui-workbench
npm ci
npm run test:ipc
npm run build
npm run dev
```

See [contributing](CONTRIBUTING.md) for native build prerequisites, test suites and branch roles.

## Attribution and license

The desktop code is distributed under [AGPL-3.0](LICENSE), with upstream authorship and Git history retained. The separately installed [Open WebUI runtime has its own license and branding requirements](https://docs.openwebui.com/license/); those are not replaced by this repository's license. Embedded Open WebUI branding remains intact.

This repository is a history-preserving copy rather than a GitHub fork-network entry, so GitHub may not display “forked from”. It remains explicitly an unofficial fork. [Provenance and modifications](docs/upstream-and-releases.md).

Community-maintained software; no commercial support agreement, security certification or uptime guarantee is included.
