# pi-subagents-h

General-purpose subagent for pi. Spawns an isolated child pi process with full tools.

```
subagent(task, model?, timeoutMs?)
```

| Tools | Thinking |
|-------|----------|
| read, grep, find, ls, bash, edit, write, parallel_search_web, read_url | xhigh |

## Usage

The main agent describes the task in natural language — the subagent figures out what to do.

```json
{ "task": "Find all auth middleware in this project and summarize their logic" }
{ "task": "Search for the latest React 19 API changes and summarize" }
{ "task": "Fix the null check in src/auth.ts and run the tests" }
{ "task": "Refactor src/utils.ts to use async/await", "model": "anthropic/claude-sonnet-4" }
```

Multiple subagents can run in parallel — they're independent processes.

## Model behaviour

Defaults to the **currently active PIA session model**. Override with `model` parameter if needed.

## Changelog

### 0.4.0
- Removed `type` parameter — the subagent now gets the full toolset and the main agent simply describes the task in natural language.

### 0.3.0
- Merged `subagent_explorer`, `subagent_searcher`, `subagent_worker` into a single unified `subagent` tool with `type` parameter.

### 0.2.3
- Fix subagent output leaking intermediate reasoning/text from multi-turn tool-call chains.
- Truncate task display in `renderCall` to 120 chars.
- Removed stderr fallback from final output.

### 0.2.2
- Fix TUI crash caused by long unwrapped lines in subagent output.

### 0.2.1
- Subagents now default to the active PIA session model.
- Fix `PI_CODING_AGENT_DIR` resolution.

### 0.2.0
- Initial release with `subagent_explorer`, `subagent_searcher`, and `subagent_worker`.
