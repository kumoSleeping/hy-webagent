# PI Extensions (bundled)

Custom [PI Coding Agent](https://github.com/earendil-works/pi-coding-agent) extensions shipped with HY-Webagent.

## Layout

```
pi-extensions/
  extensions/              → synced to each user's workspace/.pi/agent/extensions/
    goal-h.ts                goal_manager tool + auto-continue
    image-viewer/            describe_image for non-vision models
    jina-more/               parallel_search_web + read_url (needs JINA_API_KEY)
    kumoSleeping-jina-bar.ts status bar widget
    memory-4-project.ts      Memories.md + /dream
  packages/
    pi-subagents-h/          subagent_worker (needs `pi` CLI on PATH)
```

On every workspace init the server copies `extensions/` into the user's isolated agent dir and adds `packages/pi-subagents-h` to their `settings.json` `packages` list.

## Environment

| Variable | Used by |
|----------|---------|
| `VISION_MODEL` | `image-viewer` (optional, e.g. `xiaomi/mimo-v2.5`) |
| `PI_EXTENSIONS_ROOT` | Server override for this directory (default: repo `pi-extensions/`) |

Jina credentials live in PI **`auth.json`** under provider id `jina` (same file as deepseek/xiaomi):

```json
{
  "jina": { "type": "api_key", "key": "jina_..." }
}
```

On the host, add this to `~/.pi/agent/auth.json`; the platform seeds it into each user's workspace `.pi/agent/auth.json`.

LLM provider keys also use `auth.json` (or platform env injection for restricted templates).

## Local PI CLI dev

Sync bundled extensions into `~/.pi/agent/` for standalone `pi` usage:

```bash
npm run sync:pi-local
```

Then point `~/.pi/agent/settings.json` `packages` at the repo copy of `pi-subagents-h`, or run sync script which updates it.

## Adding an extension

1. Add source under `extensions/` (file or directory with `index.ts`).
2. Restart the server (or re-init workspace) — users get updates on next `ensureUserAgentDir`.
3. For a PI **package** (multi-file with `"pi": { "extensions": [...] }`), put it under `packages/` and register the path in `mergeBundledPackagesIntoSettings` if it should load for all users.
