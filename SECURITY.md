# Security and privacy

WebUI Workbench is a community-maintained Open WebUI Desktop fork, not a hardened sandbox or a hosted service. Security fixes are provided on a best-effort basis; no audit/certification or response-time guarantee is claimed.

## Report a vulnerability

Do not post tokens, exploitable details, health data or private repository contents in a public issue. Use [GitHub private vulnerability reporting](https://github.com/nicoegerer/webui-workbench/security/advisories/new) when enabled. If unavailable, open a minimal issue requesting a private contact channel without the sensitive details.

Include the fork version, affected component, reproducible steps, impact and a redacted proof of concept.

## Where data goes

- Chats, model prompts and tool results go to the Open WebUI server and model provider you choose.
- GitHub, Garmin and other connectors communicate with their configured services/accounts.
- Installation and updates contact package registries and GitHub. Runtime updates can download Python packages.
- Local service logs, configuration and caches are stored in your app profile. Chats belong to the selected Open WebUI server's database.
- A local gateway can still route requests to remote models. “Local app” does not mean “nothing leaves your computer.”

No provider credentials or personal connection profile are shipped.

## Credentials and exports

Managed connector secrets use Electron `safeStorage` when available. If OS encryption is unavailable, the existing fallback stores secrets in a local plaintext file and logs a warning. Protect your OS account/profile and disk; do not assume every platform provides an encrypted credential vault.

GitHub CLI mode uses your existing CLI authentication without copying its token into the desktop configuration. Other adapters may store login tokens in their own directories.

Connector exports omit dedicated secrets and environment values but can retain sensitive command arguments, URLs, names and paths. Review and redact exports and logs before sharing. Never commit an app profile, database or account token.

## What enabling a connector permits

Enabling a desktop tool connector makes its tools available across chats. Some tools can mutate accounts or publish information. The desktop does not provide universal per-tool permission prompts or OAuth flows. Restrict permissions at the provider/adapter where possible.

Local processes and workspace shell commands run with your user permissions. Filesystem guards reduce accidental out-of-workspace writes through file APIs, but they do not contain shell commands. A malicious repository, imported command or prompt-injected tool result can be dangerous.

Remote instances must be protected with appropriate authentication, TLS and network boundaries. Do not expose unauthenticated local services to your LAN or internet.

## Preview and updates

Preview pages do not receive desktop IPC privileges; they can still contain untrusted code or network requests. Do not load untrusted sites as though they were inert text.

Release manifests/checksums protect update integrity within the configured feed; they are not proof of trusted maintainership or a security audit. Unsigned builds may produce OS warnings. Verify the source and review what you install.

Required upstream copyright, license and branding notices remain in place. See [Open WebUI's runtime license](https://docs.openwebui.com/license/) for the separately installed runtime.
