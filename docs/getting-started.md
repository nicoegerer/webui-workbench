# Getting started

[Documentation home](../README.md)

## 1. Install the fork

Download the matching installer from [WebUI Workbench releases](https://github.com/nicoegerer/webui-workbench/releases). The version suffix `workbench.N` identifies this distribution.

New profiles start without connections or connectors. Existing upstream installations and profiles are not imported. Do not point two running instances at one database or install directory.

## 2. Choose where Open WebUI runs

- **Local:** use the first-run setup to install the managed runtime. Initial setup requires internet access and disk space for Python/packages. The standard local port is 8080; change it if another server uses it.
- **Remote:** add the URL of an Open WebUI server you control. You need a valid login there. Desktop-managed connector/workspace integration targets the managed local runtime; do not assume your remote server can reach desktop loopback endpoints.

The desktop's **Connections** page chooses an Open WebUI server. It is not the place to add an OpenAI-compatible model API.

## 3. Add a model

In the Open WebUI web interface, use the administrator connection settings to configure your chosen model provider. Select a model and send a simple message.

For a gateway such as OmniRoute, follow [the gateway guide](integrations/omniroute.md). Tool use depends on both the selected model and its provider supporting function/tool calling.

## 4. Add optional tools

Open the desktop's **Settings → Services & Connectors** (German: **Einstellungen → Dienste & Konnektoren**).

- **Discover / Entdecken:** templates and setup options.
- **Yours / Deine:** connections you actually saved.
- **Connect / Verbinden:** review the endpoint/command and authenticate before saving.
- **Pause / Pausieren:** stop access without losing the saved configuration.
- **Manage / Verwalten:** edit or remove a connection.
- **Log / Protokoll:** inspect startup or connection errors.

Signing in to the managed Open WebUI server as an administrator is required for connector registration. A running process alone does not prove that the model received its tools.

Enabled desktop tool connectors are automatically available to chats. This is a global opt-in for that connector, not a per-chat approval system. No third-party connector is enabled until you add it.

## 5. Work with files

Choose a folder/repository using the workspace chip next to the chat input. The selection is per conversation and can change without starting a new chat. Ask for a harmless test file in a disposable folder and verify it in **Files**.

See [workspaces and preview](workspaces-and-preview.md). A cloud write is a remote commit, not merely a local draft.

## 6. Updates, backups and troubleshooting

Desktop updates come from this fork; runtime updates follow its tested runtime version. The runtime's automatic-update preference can be changed in Settings. Back up data before manual migrations.

The default profile directory is named `webui-workbench` inside Electron's OS application-data location (Windows: `%APPDATA%\webui-workbench`). Chats belong to the chosen Open WebUI server/database, not to the connector export.

If setup fails:

1. Check the selected server and its logs.
2. Confirm you are signed in with the required permissions.
3. Check the service's log and endpoint/port.
4. Test a simple chat before testing file or connector tools.
5. Report a redacted issue using [the support guide](../SUPPORT.md).

“Reachable” confirms an endpoint check; it is not proof that every provider permission or tool call works.
