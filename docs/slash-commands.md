# HY-Webagent — Slash Command Design

> Version: 1.0  
> Scope: Web chat slash command system (React frontend + Express/PI SDK backend)

---

## 1. Overview

Users type `/` in the chat composer to open an autocomplete menu and execute commands. The system mirrors pi CLI core slash commands, but maps terminal UI flows to Web popovers/panels.

Design goals:

- Keep ordinary chat unchanged.
- Route system-level commands through explicit WebSocket/REST APIs.
- Let SDK auto-handle `/skill:*`, prompt templates, and extension commands by forwarding them unchanged to `session.prompt()`.
- UI style: sharp corners, white panels, theme-red corner badge (same as `LoginView`).

---

## 2. Command Taxonomy

### 2.1 SDK auto-handled (forward unchanged)

| Prefix | Example | What happens |
|--------|---------|--------------|
| `/skill:` | `/skill:my-skill` | `session.prompt()` expands the skill block. |
| `/templatename` | `/deploy` from `.pi/prompts/` | `session.prompt()` expands the prompt template. |
| Extension command | `/mycommand` | `session.prompt()` executes the extension command. |

These are **not** intercepted by the slash router; they are sent as regular `chat:prompt`.

### 2.2 Web-routed system commands

| Command | Description | UI | Backend API |
|---------|-------------|----|-------------|
| `/model` | Select current model from available models | Popover list | `slash:execute` → `model.set` |
| `/scoped-models` | Choose models available for cycling | Settings panel | `slash:execute` → `model.setScoped` |
| `/settings` | Edit thinking level, steering/follow-up mode, compaction | Settings panel | `slash:execute` → `settings.set` |
| `/new` | Start a new session | Confirm + switch | `slash:execute` → `session.new` |
| `/resume` | Pick and continue a previous session | Popover list | `slash:execute` → `session.resume` |
| `/fork` | Create a new session from a prior user message | Tree/message selector | `slash:execute` → `session.fork` |
| `/tree` | Navigate session tree | Tree panel | `slash:execute` → `session.navigateTree` |
| `/compact` | Manually compact context | Status toast | `slash:execute` → `session.compact` |
| `/name <name>` | Rename current session | Inline input | `slash:execute` → `session.name` |
| `/session` | Show session stats | Toast/panel | `slash:execute` → `session.stats` |
| `/copy` | Copy last assistant message | Toast | `slash:execute` → `session.copy` |
| `/export [html|jsonl] [path]` | Export session to HTML or JSONL | Toast/download | `slash:execute` → `session.export` |
| `/import <path>` | Import session from JSONL | File picker | `slash:execute` → `session.import` |

### 2.3 Explicitly out of scope

| Command | Reason |
|---------|--------|
| `/login`, `/logout` | Web already has API-key auth. |
| `/quit` | Browser tab close is sufficient. |
| `/share` | Would require Gist OAuth setup. |
| `/changelog`, `/hotkeys`, `/trust` | Terminal-only or low value for Web MVP. |

---

## 3. Frontend Architecture

### 3.1 ComposerBar changes

- Listen for `/` at the start of input.
- Show `SlashCommandMenu` anchored to the composer.
- Filter commands by typed prefix.
- `Enter` / click executes the selected command.
- `Esc` closes the menu.
- If a command needs arguments (e.g. `/name <name>`), show an inline argument input or dedicated panel.

### 3.2 Slash UI components

```
client/src/components/slash/
├── SlashCommandMenu.tsx        # / autocomplete list
├── SlashModelSelector.tsx      # /model popover
├── SlashScopedModels.tsx       # /scoped-models panel
├── SlashSettingsPanel.tsx      # /settings panel
├── SlashSessionTree.tsx        # /tree + /fork navigator
├── SlashResumeList.tsx         # /resume list
├── SlashExportDialog.tsx       # /export options
└── SlashToast.tsx              # feedback toast for /session, /copy, /compact
```

### 3.3 State management

- Add `client/src/stores/slashStore.ts`:
  - `slashMenuOpen`
  - `activeCommand`
  - `activePanel` (model/settings/tree/export)
  - `toast` queue

### 3.4 Message handling

If user input starts with `/` and matches a Web-routed command, send `slash:execute` via WebSocket. Otherwise send `chat:prompt` (SDK handles skill/template/extension expansion).

---

## 4. Backend Architecture

### 4.1 WebSocket message protocol

```ts
// client → server
interface SlashExecuteMessage {
  type: "slash:execute";
  payload: {
    command: string;        // e.g. "model.set"
    args?: Record<string, unknown>;
  };
}

// server → client
interface SlashResultMessage {
  type: "slash:result";
  payload: {
    command: string;
    ok: boolean;
    data?: unknown;
    message?: string;
  };
}

interface SlashErrorMessage {
  type: "slash:error";
  payload: { command: string; message: string };
}
```

### 4.2 Command router

```
server/src/slash/
├── router.ts           # main dispatch
├── model.ts            # /model, /scoped-models
├── settings.ts         # /settings
├── session.ts          # /new, /resume, /fork, /tree, /compact, /name, /session, /copy, /export, /import
└── types.ts            # shared command types
```

`router.ts` validates the command, calls the appropriate handler, and returns `slash:result` or `slash:error`.

### 4.3 Session manager extensions

`server/src/pi/session-manager.ts` gains thin wrappers:

- `getAvailableModels(sessionId)`
- `setModel(sessionId, provider, modelId)`
- `cycleModel(sessionId, direction)`
- `setScopedModels(sessionId, models)`
- `setThinkingLevel(sessionId, level)`
- `setSteeringMode(sessionId, mode)`
- `setFollowUpMode(sessionId, mode)`
- `setSessionName(sessionId, name)`
- `compact(sessionId)`
- `getSessionStats(sessionId)`
- `getSessionTree(sessionId)`
- `navigateTree(sessionId, entryId)`
- `runtimeNewSession(sessionId, options?)`
- `runtimeResumeSession(sessionId, sessionPath, cwdOverride?)`
- `runtimeForkSession(sessionId, entryId?, position?)`
- `exportToHtml(sessionId, outputPath?)`
- `exportToJsonl(sessionId, outputPath?)`
- `runtimeImportFromJsonl(sessionId, inputPath, cwdOverride?)`
- `getLastAssistantText(sessionId)`

### 4.4 Session lifecycle

`PISessionManager` keeps an optional `runtime` field on `UserPISession`. The session lifecycle commands (`/new`, `/resume`, `/fork`, `/import`) call the runtime-backed wrappers `runtimeNewSession`, `runtimeResumeSession`, `runtimeForkSession`, and `runtimeImportFromJsonl`. Each wrapper first invokes `ensureRuntime(ps)` to lazily create an `AgentSessionRuntime` via `createAgentSessionRuntime()` and caches it on the user session. The runtime then performs the replacement (`runtime.newSession`, `runtime.switchSession`, `runtime.fork`, `runtime.importFromJsonl`). The runtime's `setRebindSession` callback updates `ps.session` and `ps.sessionId` after every replacement, and the internal session map is kept in sync.

---

## 5. Security & Constraints

- All slash handlers run after existing auth middleware.
- Input sanitization (`sanitizeInput`) still applies to any argument that may be rendered or sent to SDK.
- Model switching validates the selected model is in `ModelRegistry.getAvailable()`.
- Import/export paths are constrained under the user's workspace; path traversal is rejected.
- `/compact` and `/new` require the session to be idle (not streaming).

---

## 6. Error Handling

- Unknown `/` command → show as plain prompt? No: show inline error and keep composer text.
- SDK throws → send `slash:error`, surface toast.
- Missing active session → `slash:error` with "No active session".
- Streaming conflicts → `slash:error` with "Wait for the current response to finish."

---

## 7. Verification Checklist

- [ ] `/` opens autocomplete menu.
- [ ] `/model` opens model selector and switching succeeds.
- [ ] `/settings` opens panel and changes take effect.
- [ ] `/name` renames session visible in sidebar.
- [ ] `/new` creates new active session.
- [ ] `/resume` lists previous sessions and switches.
- [ ] `/tree` displays tree and navigation works.
- [ ] `/compact` triggers compaction.
- [ ] `/session` returns stats.
- [ ] `/copy` copies last assistant text.
- [ ] `/export` produces downloadable file.
- [ ] `/import` loads a JSONL session.
- [ ] Ordinary chat and skill/template commands still work.
