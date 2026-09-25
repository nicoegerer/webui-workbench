# GitHub

[Documentation home](../../README.md) · [Workspace behavior](../workspaces-and-preview.md)

GitHub is optional. No account, token or repository is included. Open the desktop's **Settings → Services & Connectors → Discover → GitHub**.

## Option A: an existing GitHub CLI login

1. Install [GitHub CLI](https://cli.github.com/).
2. Authenticate yourself in a terminal:

   ```sh
   gh auth login
   gh auth status
   ```

3. In the connector's **GitHub access** setting, choose **Existing GitHub CLI login**.
4. Save/connect. Verify the expected account before choosing a repository.

This explicitly opts into the active `github.com` CLI account. The fork calls `gh`; it does not copy its token into Open WebUI. Account changes in the CLI can change the accessible repositories. Failure does not silently fall back to another credential.

The fork provides compact GitHub API read and Actions-log tools. This is not unrestricted administration access. Cloud file writes remain scoped to the selected repository/branch. Selected workspace actions can enable Pages for Actions, dispatch a workflow, or rerun a completed run only when explicitly requested in the current chat and permitted by GitHub.

## Option B: Personal Access Token

1. Choose **Token** mode and use the official endpoint `https://api.githubcopilot.com/mcp/`.
2. Create your own token with only the repositories/permissions you need.
3. Paste the token into the secret field, not a chat message or endpoint URL.
4. Save/connect.

For cloud file reading, the credential needs repository content access. Writing needs **Contents: read and write**. Workflow-file changes and Actions/Pages operations can need additional permissions. Branch protection and organization policies still apply. Do not grant broad administration rights just to make a failing file operation succeed.

Token mode connects to GitHub's remote MCP server; it is not identical to the fork's CLI adapter. Follow [GitHub's server and authentication documentation](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) for current endpoint requirements.

## Verify safely

- Open the workspace chip → **Cloud**, find a disposable repository and choose the intended branch.
- First ask to list/read files.
- To test writes, explicitly ask for a harmless named text file. Check the resulting commit on GitHub.
- For Actions, ask to inspect a known run and its logs. A submitted workflow request is not proof of a successful deployment.

An empty repository can be initialized by a permitted first write. A 404 can also mean missing permission, an unavailable branch or an incorrect repository; check the account before retrying.

## Disconnect

Pause or remove GitHub in **Yours**. The CLI bridge closes and cached cloud access is revoked. Removing the connector does not log out of the external GitHub CLI or revoke a PAT at GitHub; do those separately if required.
