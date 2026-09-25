# OmniRoute

[Documentation home](../../README.md)

OmniRoute is an optional **model gateway**, not a required MCP connector. You can use another OpenAI-compatible provider instead.

## Connect a separately running gateway

1. Review [OmniRoute's own installation instructions](https://github.com/diegosouzapw/OmniRoute). Its documented npm quick start is:

   ```sh
   npm install -g omniroute
   omniroute
   ```

2. Open its dashboard at `http://localhost:20128`, connect your chosen provider and obtain your gateway API key. Configure authentication and keep the gateway private.
3. In the **Open WebUI web interface → Admin Panel → Settings → Connections**, add an OpenAI-compatible connection:
   - Base URL: `http://127.0.0.1:20128/v1`
   - API key: your OmniRoute key
4. Refresh models, choose a model and send a simple message.

These endpoint details follow the [OmniRoute user guide](https://github.com/diegosouzapw/OmniRoute/wiki/User-Guide). Use the actual configured port if you changed it.

If Open WebUI runs remotely or in a container, `127.0.0.1` refers to that server/container, not your desktop. Use a deliberately secured network route appropriate to your deployment; do not expose the gateway merely to bypass a connection error.

## Optional: let the desktop manage the process

This is separate from adding the model API above.

In **Services & Connectors**, open the advanced add option for a **Local process**. Enter the executable, arguments, working directory and environment from your own installation. Start it only after reviewing them.

On Windows, commands run without a shell. If npm installed a `.cmd` shim, use the actual `node.exe` and the installed package's CLI entry point instead; locate them with `where.exe node` and `npm root -g`. Do not copy another user's absolute paths.

Use `http://127.0.0.1:20128/api/health/ping` as the readiness URL if supported by your version. Cold startup can need several minutes. Avoid running a second instance on the same port.

Pausing the managed process stops that process. Removing it does not remove the separate model API connection from Open WebUI; remove that there if you no longer want to use it. No OmniRoute process is created automatically, including from legacy autostart flags.
