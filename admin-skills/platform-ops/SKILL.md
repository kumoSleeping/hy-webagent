---
name: platform-ops
description: Platform administration — user management, usage audit, budget distribution, and admin API operations.
---

# Platform Operations (Admin)

You are operating with **administrator privileges** on HY-Webagent.

## Start here — read context file

On workspace init the server writes **`.pi/platform-admin.json`**. Always read it first:

```bash
cat ../.pi/platform-admin.json
```

Set shell variables once per command block:

```bash
CTX=$(cat ../.pi/platform-admin.json)
SESSION=$(echo "$CTX" | jq -r .sessionId)
BASE=$(echo "$CTX" | jq -r .platformAdminBase)
AUTH="Authorization: Bearer $SESSION"
```

**Use `$BASE` ( `/api/platform/admin` ) with `$SESSION`.** Do not guess URLs.

## Common tasks (copy-paste)

### List all users

```bash
curl -s -H "$AUTH" "$BASE/users" | jq .
```

### Create user

Creates the user, provisions their workspace, and seeds Jina search credentials from the server host auth.

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"displayName":"Alice","username":"alice"}' \
  "$BASE/users" | jq .
```

Response includes `credentialsSynced: true` and `workspacePath` when provisioning succeeded.

### Sync credentials (Jina search, etc.)

If a user was created before provisioning ran, or search still fails after updating server keys, push credentials to their workspace and refresh any live chat session **without restarting the server**:

```bash
curl -s -X POST -H "$AUTH" "$BASE/users/alice/sync-credentials" | jq .
```

Use after editing `/root/.pi/agent/auth.json` on the server, or when a user reports missing web search.

### User usage by model (most common audit question)

Ask: *「Alice 用了哪些模型、各多少？」* → use **usage by username**, not `?userId=` query params.

```bash
# Today (UTC), per-model breakdown
TODAY=$(date -u +%Y-%m-%d)
curl -s -H "$AUTH" "$BASE/usage/alice?from=$TODAY&to=$TODAY" | jq .

# Or by userId
curl -s -H "$AUTH" "$BASE/usage/6281250e-010c-4d03-bbf0-c1d6f231b66f?from=$TODAY&to=$TODAY" | jq .

# Which dates have data?
curl -s -H "$AUTH" "$BASE/usage/alice/daily" | jq .
```

**Response shape** (what to render for the user):

```json
{
  "displayName": "Alice",
  "from": "2026-07-02",
  "to": "2026-07-02",
  "days": [{
    "date": "2026-07-02",
    "models": {
      "deepseek/deepseek-v4-flash": {
        "input": 44781,
        "output": 3743,
        "cacheRead": 129792,
        "cacheWrite": 0,
        "turns": 19,
        "costUsd": 0.00768
      }
    },
    "totals": { "input": 51483, "output": 4362, "costUsd": 0.01146, "turns": 23 },
    "bySource": { "chat": {...}, "subagent": {...} }
  }]
}
```

Present as a table: **model | input | output | cacheRead | turns | costUsd**. Mention `bySource` if non-chat usage exists.

### All users usage for one day

```bash
curl -s -H "$AUTH" "$BASE/usage?date=$(date -u +%Y-%m-%d)" | jq .
```

### List all models (names + keys)

Before setting per-user filters, fetch the catalog and match **name** → **key** (`provider/modelId`):

```bash
curl -s -H "$AUTH" "$BASE/models" | jq .
```

Each entry: `{ key, provider, modelId, name, providerName }`. Use **key** in filters.

### Set a user's allowed models

```bash
# Alice — only DeepSeek V4 Flash (pick key from /models)
curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"models":["deepseek/deepseek-v4-flash"]}' \
  "$BASE/users/alice/model-filter" | jq .

# Mimod — Flash + Pro + Ultra Speed (example keys — verify via /models first)
curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"models":["xiaomi/mimo-v2-flash","xiaomi/mimo-v2.5-pro","xiaomi/mimo-v2-ultra-speed"]}' \
  "$BASE/users/mimod/model-filter" | jq .

# Clear filter → user sees all models again
curl -s -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"models":null}' \
  "$BASE/users/alice/model-filter" | jq .
```

Alternative body shape: `{ "allow": [ { "provider": "deepseek", "modelId": "deepseek-v4-flash" } ] }`.

## Platform admin API reference

All paths under `$BASE` = `/api/platform/admin`. Auth: `Authorization: Bearer <sessionId>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/context` | Endpoints + ready-made curl examples |
| GET | `/credential` | Your admin API key from `platform.db` |
| GET | `/users` | List users |
| GET | `/users/:idOrUsername` | User profile + today's usage snapshot |
| POST | `/users` | Create user (auto-provisions workspace + Jina credentials) |
| POST | `/users/:idOrUsername/sync-credentials` | Re-seed workspace auth + refresh live sessions |
| GET | `/models` | **All models** (key, name, provider) |
| PUT | `/users/:idOrUsername/model-filter` | **Set/clear** user's allowed models |
| GET | `/usage?date=YYYY-MM-DD` | All users for one UTC day |
| GET | `/usage/:idOrUsername?from=&to=` | **Per-user, per-day, per-model usage** |
| GET | `/usage/:idOrUsername/daily` | Dates that have usage files |

### Wrong patterns (do not use)

| Bad | Why |
|-----|-----|
| `$BASE/usage?userId=...` | No such query param; put user in path: `/usage/alice` |
| `/api/admin/usage/...` without API key | Prefer `$BASE/usage/...` with session from json file |
| Reading `data/usage/` directly | Use API; files are on server not in your cwd |

## CLI (offline fallback)

```bash
npm run admin -- users list
npm run admin -- usage today
npm run admin -- usage user alice --from 2026-07-01 --to 2026-07-02
```

## Budget rules

| Role | Default budget |
|------|----------------|
| `user` | **$2** USD (`budgetUsd: 2`) |
| `admin` | **Unlimited** (`budgetUsd: null`) |

## Safety

- Prefer session auth via `.pi/platform-admin.json`; do not paste API keys in chat
- Do not demote or delete the last admin account
