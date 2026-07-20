# PI Extensions (bundled)

Custom [PI Coding Agent](https://github.com/earendil-works/pi-coding-agent) extensions shipped with HY-Webagent.

## Layout

```
pi-extensions/
  extensions/              → synced to each user's workspace/.pi/agent/extensions/
    image-viewer/            describe_image for non-vision models
    jina-more/               parallel_search_web + read_url (needs JINA_API_KEY)
    kumoSleeping-jina-bar.ts status bar widget
```

Subagents use the official **`npm:pi-subagents`** package (same as a local PI CLI install), not a repo-bundled `pi-subagents-h`.

On every workspace init the server:

1. Copies `extensions/` into the user's isolated agent dir
2. Seeds `~/.pi/agent/npm` → `workspace/.pi/agent/npm` when the host has `pi-subagents` installed
3. Sets `settings.json` `packages` to include `npm:pi-subagents` (and removes legacy `pi-subagents-h` paths)

Before **push/deploy**, if you changed extensions in `~/.pi/agent/` instead of the repo, sync back:

```bash
npm run sync:pi-from-local
```

## Host setup (production)

On the server account that runs hy-webagent (`root` on Kumo):

```bash
mkdir -p /root/.pi/agent
# either:
pi install npm:pi-subagents
# or:
cd /root/.pi/agent/npm && npm install pi-subagents
```

`scripts/remote-update.sh` also ensures this install after pull.

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

## Local PI CLI dev

```bash
npm run sync:pi-local          # repo extensions → ~/.pi/agent/extensions
pi install npm:pi-subagents    # once, if missing
```

## Adding an extension

1. Add source under `extensions/` (file or directory with `index.ts`).
2. Restart the server (or re-init workspace) — users get updates on next `ensureUserAgentDir`.
