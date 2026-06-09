---
name: reauth-google
description: "Re-authenticate Google over chat (Signal/DM) when a Google tool fails with invalid_grant or the user asks to 'reauth google' / 'reconnect google' / 'my google auth expired'. Drives the paste-code flow: send the consent URL, take the pasted code back, exchange it, reload."
version: 1.0.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [auth, google, signal, reauth, oauth]
    related_skills: []
---

# Re-authenticate Google over chat (paste-code)

## When to use

Use this skill when **either**:
- A Google tool call (calendar, gmail, drive, docs, sheets) fails with an
  auth error — `invalid_grant`, `No tokens for identity`, "auth needed", or the
  google MCP reports it started with **auth tools only**; or
- The user asks to "reauth google", "reconnect google", "log back into google",
  or says their Google access expired.

This is the remote path: the user is on their phone over Signal/DM and there is
**no reachable browser callback** on this host. Do **not** use the
`google_auth_start` tool here (it waits on a local callback server the user's
phone can't reach). Use the paste-code tools below.

## Prerequisites

- The `google` MCP server is configured for this agent, exposing the tools
  `google_auth_url` and `google_auth_exchange`.
- The agent re-auths with **its own** Google client (the MCP already reads the
  agent's `GOOGLE_CLIENT_ID/SECRET`) — never the host's client.

## Procedure

### 1. Get the consent URL
Call **`google_auth_url`**. It returns `{ url, ... }`. Do not start a callback
flow.

### 2. Send it to the user, with clear paste instructions
Send the user one clean message (no spam, no repeats) — for example:

> Google access expired. Open this link on your phone, pick the right Google
> account, and approve:
>
> `<url>`
>
> The page it lands on will likely show an error or "can't reach this site" —
> **that's expected.** Look at the address bar, copy the long value after
> `code=` (up to the next `&`), and paste it back here.

### 3. Take the pasted code and exchange it
When the user pastes the code, call **`google_auth_exchange`** with
`{ code: "<pasted value>" }`.

- If the user pasted the whole redirected URL, extract just the `code=…` value
  (everything between `code=` and the next `&`) before calling.
- On success the tool returns `{ status: "authenticated", email }`.
- On `{ status: "error" }` (e.g. the code was already used or truncated), ask
  the user to re-open the link from step 1 and paste a **fresh** code — each
  code is single-use.

### 4. Reload so the Google tools come back
The MCP holds the old credentials in memory until it restarts. After a
successful exchange, **reload this agent with a quick restart** through the
harness manager (HSM) so the Google tools pick up the new token. Use the harness
restart capability available to you (`mode: quick`). If you do not have a
self-restart capability, tell the user exactly that: re-auth succeeded and saved,
and the Google tools will be live again right after the next quick restart.

### 5. Confirm
Once reloaded, confirm to the user: "Google reconnected as `<email>` — back in
business." Then retry whatever Google action was originally requested.

## Notes

- **One message, not many.** Respect the user's attention: a single clear
  instruction in step 2, a single confirmation in step 5. Never loop reconnect
  notices.
- **Codes are single-use and short-lived.** If exchange fails, always restart
  from a fresh `google_auth_url`.
- **Identity safety.** The consent URL is bound to this agent's identity; the
  user must approve with the correct Google account for this agent.
