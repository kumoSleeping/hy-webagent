# PI Extensions (bundled)

Custom [PI Coding Agent](https://github.com/earendil-works/pi-coding-agent) extensions shipped with HY-Webagent.

## Layout

```
pi-extensions/
  extensions/              → synced to each user's workspace/.pi/agent/extensions/
    image-viewer/            describe_image for non-vision models
    jina-more/               parallel_search_web + read_url (needs JINA_API_KEY)
    kumoSleeping-jina-bar.ts status bar widget
    bark-notify-prompt.ts     optional Bark reminders (needs BARK_NOTIFY_URL)
```

Platform-managed npm extensions currently include **`npm:pi-subagents`** and
**`npm:@howaboua/pi-codex-conversion@2.2.19`**. They are installed on the host
and mirrored into each workspace; they are not copied into `extensions/`.

On every workspace init the server:

1. Copies `extensions/` into the user's isolated agent dir
2. Links `workspace/.pi/agent/npm` to the host-managed npm tree
3. Adds the managed npm package specs to `settings.json` (and removes legacy `pi-subagents-h` paths)

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
pi install npm:@howaboua/pi-codex-conversion@2.2.19
# or:
cd /root/.pi/agent/npm
npm install pi-subagents @howaboua/pi-codex-conversion@2.2.19
```

`scripts/remote-update.sh` also ensures both installs after pull.

## Environment

| Variable | Used by |
|----------|---------|
| `VISION_MODEL` | `image-viewer` (optional, e.g. `xiaomi/mimo-v2.5`) |
| `PI_EXTENSIONS_ROOT` | Server override for this directory (default: repo `pi-extensions/`) |
| `BARK_NOTIFY_URL` | Optional private Bark base URL used by `bark-notify-prompt.ts` |

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
pi install npm:@howaboua/pi-codex-conversion@2.2.19
```

## Adding an extension

1. Add source under `extensions/` (file or directory with `index.ts`).
2. Restart the server (or re-init workspace) — users get updates on next `ensureUserAgentDir`.
