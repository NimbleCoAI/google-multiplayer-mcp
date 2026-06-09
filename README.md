# google multiplayer mcp

OAuth-based Google Workspace MCP server for Hermes agents. Replaces `workspace-mcp` with per-agent permission enforcement.

## Setup

1. Create `~/.nimbleco-google/config.json`:

```json
{
  "clientId": "YOUR_GOOGLE_CLIENT_ID",
  "clientSecret": "YOUR_GOOGLE_CLIENT_SECRET"
}
```

2. Authenticate each identity:

```bash
npx google-multiplayer-mcp auth personal
npx google-multiplayer-mcp auth frontdoor
```

3. Create a permission config for each agent (see `examples/`).

4. Update Hermes agent `config.yaml`:

```yaml
mcp_servers:
  google:
    command: npx
    args:
      - github:NimbleCoAI/google-multiplayer-mcp
      - --config
      - /opt/data/google-permissions.yaml
    env:
      GOOGLE_TOKEN_DIR: /opt/google/tokens
```

5. Mount tokens in `docker-compose.yml`:

```yaml
volumes:
  - ~/.nimbleco-google/tokens:/opt/google/tokens:ro
```

## Permission Levels

| Level | Operations |
|-------|-----------|
| `none` | Service disabled |
| `read` | list, get, search, download |
| `write` | read + create, update, upload |
| `admin` | write + delete, share, trash (must be explicit) |

## Auth Commands

```bash
google-multiplayer-mcp auth <identity>   # OAuth flow (opens browser)
google-multiplayer-mcp auth status        # Show all identities
```

## Re-auth from chat (paste-code, no browser callback)

When an agent runs on a remote/headless host, the user's phone can't reach the
local OAuth callback server — so the browser-callback flow can't complete. For
that case the MCP exposes two tools that drive a **paste-code** flow:

| Tool | Purpose |
|------|---------|
| `google_auth_url` | Returns the consent URL (no callback server started). |
| `google_auth_exchange` | Takes the pasted `code=…` value, exchanges it for tokens, saves them. |

Flow: the agent sends `google_auth_url`'s URL to the user → the user consents on
their phone and copies the `code=…` from the redirected URL (which may show an
error — only the code matters) → pastes it back → the agent calls
`google_auth_exchange` → the MCP is reloaded (HSM quick-restart) so the Google
tools pick up the new token.

The companion agent skill `skills/reauth-google/SKILL.md` packages this as a
"reauth google" procedure for Signal/DM, including proactive use on
`invalid_grant`. The MCP starts in **auth-tools-only** mode when tokens are
missing/invalid (it does not exit), so these auth tools are always reachable.
