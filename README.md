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
