# Garmin

[Documentation home](../../README.md)

Garmin is optional and is **not an official integration of this fork**. You supply a third-party MCP implementation and your own account. Fitness and health results can be sent to your chosen model provider.

## Example: a local stdio MCP server

One compatible-style implementation is [Taxuspt/garmin_mcp](https://github.com/Taxuspt/garmin_mcp). Review its code, requirements and current instructions before installing. Its documentation uses Python 3.12+ and a separate interactive authentication command:

```sh
uvx --python 3.12 --from git+https://github.com/Taxuspt/garmin_mcp garmin-mcp-auth
```

Complete login/MFA yourself. This example downloads third-party code; pin an audited release/commit for repeatable deployments. Do not give account passwords to the model.

## Add it in the desktop

Choose **Services & Connectors → advanced add → MCP → OpenAPI** (local MCP adapter).

| Field | Example |
| --- | --- |
| Name | Garmin |
| MCP executable | `uvx` or its absolute path |
| Arguments, one per line | the five lines below |
| Port | an unused loopback port, e.g. `8000` |
| Environment | empty when using the adapter's saved login |

```text
--python
3.12
--from
git+https://github.com/Taxuspt/garmin_mcp
garmin-mcp
```

The fork wraps the stdio server with authenticated loopback `mcpo`, generates the bridge key and registers it with the managed Open WebUI instance. Install `uv`/`uvx` separately if it is not found. The outer mcpo runner and the MCP executable are separate fields.

## Verify and limit access

Connect, inspect the log, then request one read-only item such as your recent activity list. Check that a real tool call succeeded. Account authentication has not been performed for other users by this repository's test suite.

Some Garmin adapters also expose write operations. Enable only tools/permissions you trust, where the adapter supports filtering. For stronger isolation, use a read-only adapter rather than relying solely on a prompt.

If login expires or MFA is requested, authenticate again outside the chat. If startup fails, check the server's dependency requirements and a free port; do not paste secrets into a public issue.

Pause/remove the desktop connector to stop chat access. The adapter's externally stored login tokens remain its responsibility and may need separate revocation/deletion.
