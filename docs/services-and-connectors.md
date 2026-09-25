# Services & Connectors

[Documentation home](../README.md)

All connections are optional. A fresh profile contains an empty registry. Discover cards describe possibilities; they do not grant access or install personal accounts.

## Choose the right kind of connection

| You want to connect… | Where / how |
| --- | --- |
| An Open WebUI server | Desktop Connections |
| An OpenAI-compatible model endpoint | Open WebUI administrator model Connections |
| GitHub | [GitHub guide](integrations/github.md) |
| Garmin through a local MCP server | [Garmin guide](integrations/garmin.md) |
| A local stdio MCP server | Advanced add → MCP → OpenAPI |
| An existing Streamable HTTP MCP endpoint | Remote MCP / custom remote connector |
| A background executable such as OmniRoute | Advanced add → Local process |

## Add and verify

1. Open the desktop **Settings → Services & Connectors**.
2. Use **Discover** for templates or the advanced add options for your own service.
3. Review the executable/URL, arguments, environment, working directory and permissions.
4. Authenticate with the provider yourself, then save/connect.
5. Check **Yours**, the service log, and one harmless read-only tool call.

The managed Open WebUI account must be an administrator for automatic registration. Generic processes are not automatically tools. Enabled MCP/remote connectors are made available to all chats; they are hidden from duplicate per-chat controls to avoid misleading “off” switches. Control their access in **Yours**.

Pausing preserves configuration but stops/disables access. Removing deletes that saved connection and its managed registration, not provider accounts or third-party installations. Workspace servers are created on deliberate selection and cleaned up when no longer needed; see [workspaces](workspaces-and-preview.md).

## Local MCP details

The fork starts `uvx --refresh --with mcp==1.9.4 mcpo …` bound to loopback, with a generated bearer key, followed by your MCP executable and arguments. `uvx` or an explicit runner path is required. Commands are started with `shell: false`; arguments go one per line and must not rely on shell expansion.

Do not start a second process on an occupied port. A service is not adopted merely because an unrelated process is listening there. For an externally managed endpoint, configure that endpoint explicitly.

## Gmail, Drive, Calendar and other providers

The catalog includes Google setup guidance, but a catalog entry is not a working signed-in account. You need an available MCP endpoint/adapter and the provider's authentication, project configuration and permissions. This fork does **not** provide a universal Google OAuth login flow or guarantee access to preview endpoints.

For providers requiring an OAuth flow unsupported here, authenticate through a compatible adapter and connect its local stdio or authorized remote endpoint. Do not substitute an account password for a bearer token. Provider availability and terms can change independently of this fork.

## Sharing configuration

Export omits managed environment values and dedicated token/key fields. **It is not a general secret scrubber:** URLs, arguments, names and paths can still contain private data or embedded credentials. Review the complete file before sharing.

Import presents the commands for confirmation before replacing the current registry. Treat an imported connector like executable code. It can run commands or contact remote services after you enable it.

Read [privacy and security](../SECURITY.md) before enabling tools.
