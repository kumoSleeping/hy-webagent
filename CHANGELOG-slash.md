# CHANGELOG — Slash Command System

## 2026-06-29

### Added

- **Design doc**: `docs/slash-commands.md` with command taxonomy, message protocol, and API contract.
- **Backend slash router** (`server/src/slash/`):
  - `model.set`, `model.cycle`, `model.setScoped`
  - `settings.set` (thinking level, steering/follow-up mode, etc.)
  - `session.new`, `session.resume`, `session.fork`, `session.tree`, `session.navigateTree`
  - `session.compact`, `session.name`, `session.stats`, `session.copy`
  - `session.exportHtml`, `session.exportJsonl`, `session.importJsonl`
- **SDK wrappers** in `server/src/pi/session-manager.ts` for model/session operations and lazy `AgentSessionRuntime` creation.
- **REST endpoints**:
  - `GET /api/models` — available models + current model
  - `GET /api/sessions/:id/tree` — session tree
  - `GET /api/slash/commands` — system + dynamic commands
- **WebSocket protocol**: `slash:execute` / `slash:result` / `slash:error`.
- **Frontend components** (`client/src/components/slash/`):
  - `SlashCommandMenu` autocomplete
  - `SlashModelSelector`
  - `SlashSettingsPanel`
  - `SlashSessionTree`
  - `SlashResumeList`
  - `SlashExportDialog`
  - `SlashToast`
- **Dynamic command discovery**: prompt templates, skills, and extension commands are auto-loaded into the slash menu.
- **Tests**:
  - `server/src/test/slash-commands.test.ts` (16 tests)
  - `server/src/test/benchmark-api.ts`
  - `server/src/test/verify-slash.ts`
  - `client/src/components/slash/SlashCommandMenu.test.tsx` (3 tests)
- **Docs**: updated `README.md` and `technical-report.md`.

### Verified

- Server and client builds pass.
- All unit tests pass (16 server slash tests + 3 client component tests).
- Benchmark script runs and outputs latency percentiles.
- End-to-end verification script passes 19/19 checks (model switch, settings, tree, import/export, new/resume/fork, scoped-models, copy/compact/name/stats, export panel advertisement).
- Dynamic prompt template auto-discovery verified with a temporary `.pi/prompts/hyw.md` in the test workspace; an example is provided at `examples/prompts/hyw.md`.

### Known limitations

- `/share` (Gist upload) is out of scope.
- `/login`, `/logout`, `/quit`, `/changelog`, `/hotkeys`, `/trust` are not implemented.
- Custom extension UI is not rendered; extension commands are sent to SDK as text.
