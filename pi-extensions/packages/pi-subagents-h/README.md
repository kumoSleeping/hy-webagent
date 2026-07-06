# pi-subagents-h

Three specialised subagent workers for pi. Each spawns an isolated child pi process.

- `subagent_explorer` — read-only exploration (read, grep, find, ls)
- `subagent_searcher` — web research + read-only local tools (parallel_search_web, read_url, read, grep, find, ls)
- `subagent_worker` — full implementation tools (read, grep, find, ls, bash, edit, write)

## Model behaviour

All three tools default to the **currently active PIA session model**. No extra API keys or per-agent model configuration is required — they reuse whatever model the main agent is already using.

- Explorer and Searcher run with `xhigh` thinking.
- Worker inherits the active model's normal thinking level (pass `--thinking` via `model` override if needed).

### Override on a per-call basis

Only `subagent_worker` exposes a `model` parameter. Explorer and Searcher always use the active session model so they stay zero-config.

```json
{ "task": "Fix null check in auth.ts and run tests" }
{ "task": "Refactor utils.ts", "model": "anthropic/claude-sonnet-4" }
```

## Tool parameters

### `subagent_explorer` / `subagent_searcher`

- **task** — what to explore or research
- **timeoutMs** — optional timeout

### `subagent_worker`

- **task** — what to implement
- **model** — optional model string such as `provider/id`; defaults to active session model
- **timeoutMs** — optional timeout

## Why default to the active model?

Hard-coding models (e.g. `deepseek/deepseek-v4-flash`) requires that provider to be configured and available. By defaulting to the active session model, the subagents work out of the box in any PIA session.

## Changelog

### 0.2.3
- Fix subagent output leaking intermediate reasoning/text from multi-turn tool-call chains. Changed `finalOutput` to only capture the **last** assistant message's text (matching the built-in subagent's `getFinalOutput` behaviour), instead of concatenating text from every message.
- Truncate task display in `renderCall` to 120 chars (single-line) to prevent huge repeated task descriptions from flooding the screen.
- Removed stderr fallback from final output to avoid leaking debug/process output.

### 0.2.2
- Fix TUI crash caused by long unwrapped lines in subagent output. All tool results are now passed through `wrapTextWithAnsi` to keep rendered lines within a safe width.

### 0.2.1
- Subagents now default to the active PIA session model instead of hard-coding `deepseek` models.
- Fix `PI_CODING_AGENT_DIR` resolution so child pi processes can find user config and API keys.

### 0.2.0
- Initial release with `subagent_explorer`, `subagent_searcher`, and `subagent_worker`.

