/**
 * btw-web — legacy extension example (TUI / direct LLM).
 * PI Web Platform uses the fork-based `btw:ask` websocket flow instead.
 * Do not register this extension for web — it bypasses the main agent pipeline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AssistantMessage,
  completeSimple,
  type Message,
  type UserMessage,
} from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const BTW_COMMAND_NAME = "btw";
const BTW_NEW_NAME = "btw-new";
const BTW_STATE_KEY = Symbol.for("pi-web-btw");
const BTW_WIDGET_KEY = "btw";

const BTW_SYSTEM_PROMPT = readFileSync(
  fileURLToPath(new URL("./prompts/btw-system.txt", import.meta.url)),
  "utf-8"
).trimEnd();

interface BtwTurn {
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
}

interface BtwState {
  histories: Map<string, BtwTurn[]>;
  snapshots: Map<string, { messages: Message[] }>;
}

function getState(): BtwState {
  const g = globalThis as unknown as { [k: symbol]: BtwState | undefined };
  if (!g[BTW_STATE_KEY]) {
    g[BTW_STATE_KEY] = { histories: new Map(), snapshots: new Map() };
  }
  return g[BTW_STATE_KEY]!;
}

function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? `memory:${ctx.sessionManager.getSessionId()}`;
}

function getHistory(ctx: ExtensionContext): BtwTurn[] {
  const key = sessionKey(ctx);
  const state = getState();
  if (!state.histories.has(key)) state.histories.set(key, []);
  return state.histories.get(key)!;
}

function pushTurn(ctx: ExtensionContext, turn: BtwTurn) {
  getHistory(ctx).push(turn);
}

function clearHistory(ctx: ExtensionContext) {
  getState().histories.set(sessionKey(ctx), []);
}

function branchToMessages(branch: SessionEntry[]): Message[] {
  const agentMessages = branch
    .filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
    .map((e) => e.message);
  return convertToLlm(agentMessages);
}

function userText(msg: UserMessage): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function assistantText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function readBranch(ctx: ExtensionContext): Message[] {
  const snap = getState().snapshots.get(sessionKey(ctx));
  if (snap) return snap.messages;
  return branchToMessages(ctx.sessionManager.getBranch() as SessionEntry[]);
}

function renderWidgetLines(opts: {
  history: BtwTurn[];
  question?: string;
  answer?: string;
  pending?: boolean;
  error?: string;
}): string[] {
  const lines: string[] = [];
  for (const turn of opts.history) {
    lines.push(`Q: ${userText(turn.userMessage)}`);
    lines.push(`A: ${assistantText(turn.assistantMessage)}`);
    lines.push("");
  }
  if (opts.question) {
    lines.push(`Q: ${opts.question}`);
    if (opts.pending) lines.push("…");
    else if (opts.error) lines.push(`✗ ${opts.error}`);
    else if (opts.answer) lines.push(`A: ${opts.answer}`);
    lines.push("");
  }
  return lines;
}

function showWidget(ctx: ExtensionCommandContext, lines: string[]) {
  ctx.ui.setWidget(BTW_WIDGET_KEY, lines, { placement: "aboveEditor" });
}

function resetBtw(ctx: ExtensionCommandContext) {
  clearHistory(ctx);
  ctx.ui.setWidget(BTW_WIDGET_KEY, undefined);
}

async function executeBtw(question: string, ctx: ExtensionCommandContext) {
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("/btw requires an active model", "error");
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    ctx.ui.notify(`/btw model misconfigured: ${auth.error}`, "error");
    return;
  }
  if (!auth.apiKey) {
    ctx.ui.notify("/btw model has no API key", "error");
    return;
  }

  const history = [...getHistory(ctx)];
  showWidget(ctx, renderWidgetLines({ history, question, pending: true }));

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: question }],
    timestamp: Date.now(),
  };
  const historyMsgs: Message[] = history.flatMap((h) => [h.userMessage, h.assistantMessage]);
  const messages = [...readBranch(ctx), ...historyMsgs, userMessage];

  try {
    // Side Q&A must not share the main agent's abort signal — /btw runs while the
    // agent is streaming and ctx.signal is tied to the current turn, so passing
    // it here would cancel the side call when the main turn ends.
    const response = await completeSimple(
      model,
      { systemPrompt: BTW_SYSTEM_PROMPT, messages, tools: [] },
      { apiKey: auth.apiKey, headers: auth.headers }
    );

    if (response.stopReason === "aborted") {
      showWidget(
        ctx,
        renderWidgetLines({ history, question, error: "side question cancelled" })
      );
      return;
    }
    if (response.stopReason === "error") {
      showWidget(
        ctx,
        renderWidgetLines({ history, question, error: response.errorMessage ?? "call failed" })
      );
      return;
    }

    const answer = assistantText(response).trim();
    if (!answer) {
      showWidget(ctx, renderWidgetLines({ history, question, error: "empty response" }));
      return;
    }

    pushTurn(ctx, { userMessage, assistantMessage: response });
    showWidget(ctx, renderWidgetLines({ history: getHistory(ctx) }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showWidget(ctx, renderWidgetLines({ history, question, error: msg }));
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(BTW_COMMAND_NAME, {
    description: "Ask a side question (shown in workspace panel, not main chat)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/btw requires interactive UI", "error");
        return;
      }
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /btw <question>", "warning");
        return;
      }
      await executeBtw(question, ctx);
    },
  });

  pi.registerCommand(BTW_NEW_NAME, {
    description: "Start a fresh /btw side thread (clears current side Q&A)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      resetBtw(ctx);
    },
  });

  pi.on("message_end", async (event, ctx) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;
    if ((msg as AssistantMessage).stopReason === "toolUse") return;
    const branch = ctx.sessionManager.getBranch() as SessionEntry[];
    getState().snapshots.set(sessionKey(ctx), { messages: branchToMessages(branch) });
  });

  pi.on("session_compact", async (_e, ctx) => {
    try {
      getState().snapshots.delete(sessionKey(ctx));
    } catch {
      /* stale ctx after compact */
    }
  });

  pi.on("session_tree", async (_e, ctx) => {
    try {
      getState().snapshots.delete(sessionKey(ctx));
    } catch {
      /* stale ctx */
    }
  });
}
