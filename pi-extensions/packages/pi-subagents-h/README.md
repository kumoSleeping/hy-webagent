# pi-subagents-h

Minimal worker subagent for pi. Spawns child pi processes for implementation tasks.

## Tool

### `subagent_worker`
Execute implementation tasks with full read/write access.

```
{ task: "Fix null check in auth.ts and run tests" }
{ task: "...", model: "anthropic/claude-sonnet-4" }
```

- **task** — what to do
- **model** — optional, defaults to current session model
- **timeoutMs** — optional timeout

Worker has: `read, grep, find, ls, bash, edit, write`.
