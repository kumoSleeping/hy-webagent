---
name: bot-group-ops
description: Manage pi-web-platform Bot accounts, API key rotation, Bot enablement, registered group channels, and group session organization. Use when an administrator asks to create or configure a messaging Bot, issue or rotate its API key, inspect connected QQ groups, find group workspace URLs, or review group session activity.
---

# Bot Group Operations

Read `../.pi/platform-admin.json` first. Use its `platformAdminBase` and `sessionId`; never guess the server URL and never use a Bot API key for administrator calls.

```bash
CTX=$(cat ../.pi/platform-admin.json)
BASE=$(echo "$CTX" | jq -r .platformAdminBase)
SESSION=$(echo "$CTX" | jq -r .sessionId)
AUTH="Authorization: Bearer $SESSION"
```

## Create a Bot

Use a stable lowercase slug because it identifies the Bot in administrator APIs.

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"slug":"kgy","displayName":"Kaguya Bot"}' \
  "$BASE/bots" | jq .
```

The response contains `apiKey` once. Present it to the administrator and explicitly state that it must be placed in the Entari `entari_plugin_pi_web.api_key` configuration. Do not write it into project files unless the administrator asks.

## Inspect Bots and Groups

```bash
curl -s -H "$AUTH" "$BASE/bots" | jq .
curl -s -H "$AUTH" "$BASE/bots/kgy/channels" | jq .
```

For a registered channel, query its public session list and report the newest session's `viewUrl`:

```bash
ORIGIN=$(echo "$BASE" | sed 's#/api/platform/admin$##')
curl -s "$ORIGIN/api/public/bots/kgy/channels/666808414" | jq -r '.sessions[0].viewUrl'
```

The canonical read-only URL is `<platform origin>/<bot slug>/<channel id>`. The legacy
`/bot_<slug>/channel_<channel id>` route is compatibility-only and should not be presented as a new link.

## Disable or Rename a Bot

```bash
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"enabled":false}' "$BASE/bots/kgy" | jq .

curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"displayName":"Kaguya Production Bot"}' "$BASE/bots/kgy" | jq .
```

Disabling rejects new Bot logins without deleting group history.

## Rotate a Bot Key

```bash
curl -s -X POST -H "$AUTH" "$BASE/bots/kgy/rotate-key" | jq .
```

Warn that rotation immediately revokes existing Bot login sessions and requires replacing the key in Entari configuration.

## Safety

- Treat Bot API keys as secrets; never place them in group workspace URLs, summaries, or logs.
- Never include the Bot API key or internal user ID in URLs.
- Prefer disable over deletion so historical group sessions remain inspectable.
- Confirm the target slug before disabling or rotating a production Bot.
- Report API errors directly; do not fall back to editing `platform.db`.
