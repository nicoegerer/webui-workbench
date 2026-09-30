# Connect your own services

[Documentation home](../README.md) · [Deutsch](services-and-connectors.de.md)

All connections are optional. A fresh profile contains an empty registry. Discover cards describe possibilities; they do not grant access or install personal accounts. This guide applies to any compatible provider. Saved connections survive updates.

## Choose the right kind of connection

| You want to connect…                     | Where / how                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| An Open WebUI server                     | Desktop Connections                                                              |
| An OpenAI-compatible model endpoint      | Open WebUI administrator model Connections                                       |
| GitHub                                   | [Workspace access and permissions](workspaces-and-preview.md#github-access)      |
| A local stdio MCP server                 | Discover → Local connector (mcpo adapter)                                        |
| An existing Streamable HTTP MCP endpoint | Remote MCP / custom remote connector                                             |
| An ordinary background executable        | Advanced add → Local process                                                     |
| Local files and shell commands           | Desktop Open Terminal settings, then select a workspace beside the message input |

The desktop settings and the embedded Open WebUI administrator settings are different. A model gateway belongs in **model Connections**, not the MCP tool list. It may additionally be managed as a local process.

Local MCP servers use the same generic adapter, regardless of provider. Read the server author's installation and authentication instructions; complete browser consent, interactive login and MFA outside the chat. Never send credentials to a model.

## Add and verify

1. Open the desktop **Settings → Services & Connectors**.
2. Use **Discover** for templates or the advanced add options for your own service.
3. Review the executable/URL, arguments, environment, working directory and permissions.
4. Authenticate with the provider yourself, then save/connect.
5. Check **Yours**, the service log, and one harmless read-only tool call.

The managed Open WebUI account must be an administrator for automatic registration. Generic processes are not automatically tools. Enabled MCP/remote connectors are made available to all chats; they are hidden from duplicate per-chat controls to avoid misleading “off” switches. Control their access in **Yours**.

Pausing preserves configuration but stops/disables access. Removing deletes that saved connection and its managed registration, not provider accounts or third-party installations. Workspace servers are created on deliberate selection and cleaned up when no longer needed; see [workspaces](workspaces-and-preview.md).

## Local MCP details

Choose **Discover → Local connector** and split the author's stdio launch command into executable and arguments:

| Form field                           | What to enter                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| Name                                 | Your own descriptive name; it does not change how the server runs                      |
| Server program                       | The executable alone; use an absolute path if discovery fails                          |
| Arguments, one per line              | One literal argument per line, in the original order, without repeating the executable |
| Use in chats and start automatically | Global opt-in: start this connector and make its tools available across chats          |
| Advanced → Local port                | An unused port for the adapter, not the stdio child                                    |
| Adapter program                      | `uvx` or its absolute path; separate from the server executable                        |
| Working directory                    | Optional command start directory, not the chat's workspace selection                   |
| Environment variables                | Values required by the provider; use these for secrets instead of arguments            |
| Status URL                           | Optional documented readiness endpoint; do not assume every server has `/health`       |
| Start timeout / restarts             | Allow for cold starts; inspect errors before increasing retries                        |

Example of splitting a command (**placeholder only**, not an installable connector): `python "C:\Tools\example-mcp\server.py" --transport stdio` becomes server program `python` and three argument lines:

```text
C:\Tools\example-mcp\server.py
--transport
stdio
```

Do not add shell quotes around a path containing spaces in an argument field. `&&`, redirection, `%VARIABLE%`, `~` and shell substitutions are not expanded. On Windows, a `.cmd`/`.bat` shim may require the underlying real executable and script path described by the server author. Do not add `cmd /c` merely to conceal a failed command.

The fork starts `uvx --refresh --with mcp==1.9.4 mcpo …` bound to loopback, with a generated bearer key, followed by your MCP executable and arguments. `uvx` or an explicit runner path is required. Commands are started with `shell: false`; arguments go one per line and must not rely on shell expansion.

Do not start a second process on an occupied port. A service is not adopted merely because an unrelated process is listening there. For an externally managed endpoint, configure that endpoint explicitly.

## Remote MCP endpoints

Use the provider's exact **Streamable HTTP MCP** endpoint and supported authentication mode. Put a bearer token in the dedicated token field when required. A normal website, old SSE endpoint, OpenAPI document or model API is not interchangeable with an MCP endpoint. The [workspace guide](workspaces-and-preview.md#github-access) covers GitHub's supported CLI-login alternative and repository-specific permissions.

## Ordinary processes and model gateways

Use **Advanced add → Local process** for software the desktop should supervise. Supply the real executable, arguments, environment, optional working directory and documented health check. A running generic process is not automatically registered as tools or a model provider.

If a process was accidentally saved as MCP, open **Yours → Manage → Advanced → Connection type → Local process**, then save. The executable and arguments are retained; adapter-only settings are removed. Saving closes the editor while startup continues in the service card. Check its status/log or stop it there; repeated start failures stop at the configured restart limit.

For a gateway you already run manually, skip process management:

1. Install and authenticate the gateway using its author's instructions.
2. Add its OpenAI-compatible API base URL (often ending in `/v1`) and required key in Open WebUI's **Administrator settings → Connections**.
3. Refresh the model list, select a model and send a simple message.

Use the actual configured port and do not start another copy on it. If Open WebUI runs remotely or in a container, `127.0.0.1` refers to that server/container, not your desktop. Configure a secured route appropriate to your deployment.

For npm-based processes on Windows, locate `node.exe` with `where.exe node` and the global package directory with `npm root -g`, then use the package's documented CLI entry point. Do not copy another user's absolute paths. A cold start can take several minutes; use the provider's documented health endpoint instead of assuming `/health`.

Pausing or removing a managed process does not remove its separate model connection in Open WebUI. Manage that connection in the model settings.

For local-only use, bind services to `127.0.0.1`. A server listening on `0.0.0.0` without authentication can let other reachable devices use your accounts or model credits. Do not disable authentication to make a status check green.

## Open Terminal and project folders

Open **desktop Settings → Open Terminal → Install/Start**. The app installs the tested runtime when needed. **Start** keeps that service running for this session even when **Start on launch** is off. Enabling the switch starts it immediately and on future app launches; disabling it does not stop a running session. Fresh profiles leave it off. **Stop** ends the active instance. The same opt-in behavior applies to **Inference Runtime → llama.cpp**; a local model must also be installed and selected to chat. Startup failures are shown in the settings rather than reported as a successful connection.

With no working directory configured, the service uses your home directory. For a project, select its actual folder with the workspace chip beside the message input; a workspace terminal starts as needed. Changing folders does not relocate files. Idle chat-owned instances can be released automatically; live commands, terminal sessions and explicitly started services are retained.

Commands execute with your OS user's permissions, **not in a sandbox**. GitHub cloud workspaces do not provide a cloud shell. See [workspaces and preview](workspaces-and-preview.md).

## Troubleshooting checklist

| Symptom                              | Check first                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Executable not found                 | Install its prerequisite or use an absolute executable path; restart the desktop after PATH changes |
| Port occupied                        | Stop the duplicate intentionally or choose another unused adapter port                              |
| Authentication error / MFA           | Authenticate outside chat; check provider scopes and token expiry                                   |
| Process exits immediately            | First log error, arguments, runtime requirements and working directory                              |
| Running, but no tools                | Connector type, administrator sync, permissions and a tool-capable model                            |
| Open Terminal stops just after Start | Update the desktop: versions through `workbench.3` could release a manually started idle service    |
| Wrong folder or preview              | Workspace chip, full path and the workspace guide                                                   |

Test one harmless read-only tool call first. For file work, request one small file in a disposable selected folder and verify **Files** and the full path. A plain model response or green endpoint alone is not proof of working tools.

## Gmail, Drive, Calendar and other providers

The catalog includes Google setup guidance, but a catalog entry is not a working signed-in account. You need an available MCP endpoint/adapter and the provider's authentication, project configuration and permissions. This fork does **not** provide a universal Google OAuth login flow or guarantee access to preview endpoints.

For providers requiring an OAuth flow unsupported here, authenticate through a compatible adapter and connect its local stdio or authorized remote endpoint. Do not substitute an account password for a bearer token. Provider availability and terms can change independently of this fork.

## Sharing configuration

Export omits managed environment values and dedicated token/key fields. **It is not a general secret scrubber:** URLs, arguments, names and paths can still contain private data or embedded credentials. Review the complete file before sharing.

Import presents the commands for confirmation before replacing the current registry. Treat an imported connector like executable code. It can run commands or contact remote services after you enable it.

Read [privacy and security](../SECURITY.md) before enabling tools.
