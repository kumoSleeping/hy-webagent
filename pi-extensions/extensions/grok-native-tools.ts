/**
 * grok-native-tools — Inject + surface xAI server-side tools (extension only).
 *
 * - before_provider_request: inject native tools when model is Grok
 * - fetch wrapper: parse Responses SSE for web_search_call / x_search_call / …
 *   and emit structured web tool activity when the host supports it
 *
 * Bar badge: "grok-native-tools ✓" (Grok only, drawn by kumoSleeping-jina-bar)
 *
 * Injected (no extra config):
 *   web_search, x_search, code_interpreter, view_image, view_x_video
 *
 * Skipped (need IDs / URLs):
 *   collections_search / file_search, mcp_server
 *
 * Pair with jina-more (disables Jina tools while Grok is active).
 */

import type { ExtensionAPI, ModelSelectEvent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** Exported for status bar / other extensions. */
export const GROK_NATIVE_TOOLS = [
  { type: "web_search" },
  { type: "x_search" },
  { type: "code_interpreter" },
  { type: "view_image" },
  { type: "view_x_video" },
] as const;

/** Bottom status bar — keep in sync with kumoSleeping-jina-bar.ts */
export const GROK_NATIVE_TOOLS_LABEL = "grok-native-tools ✓ · via Sorux";
export const GROK_SERVER_TOOL_ENTRY = "pi-web-server-tool:v1";

const GROK_OUTPUT_RULES = [
  "When using server-side tools, keep search/open progress narration in reasoning only.",
  "Do not emit progress narration in output_text.",
  "After all tools finish, begin the final answer directly and do not use horizontal-rule separators.",
].join(" ");

function isGrokModel(model?: { id?: string; provider?: string } | null): boolean {
  if (!model) return false;
  if (process.env.PI_GROK_STANDARD_TOOLS === "1") return false;
  return !!(model.id?.includes("grok") || model.provider === "xai");
}

type ToolEntry = { type?: string; name?: string; [key: string]: unknown };

function injectNativeTools(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const next = { ...(payload as Record<string, unknown>) };
  const tools: ToolEntry[] = Array.isArray(next.tools)
    ? [...(next.tools as ToolEntry[])]
    : [];

  const existing = new Set(
    tools.map((t) => (t && typeof t.type === "string" ? t.type : "")).filter(Boolean),
  );

  for (let i = GROK_NATIVE_TOOLS.length - 1; i >= 0; i--) {
    const tool = GROK_NATIVE_TOOLS[i];
    if (!existing.has(tool.type)) {
      tools.unshift({ ...tool });
      existing.add(tool.type);
    }
  }

  next.tools = tools;
  if (typeof next.instructions === "string") {
    next.instructions = `${next.instructions.trim()}\n\n${GROK_OUTPUT_RULES}`;
  } else if (next.instructions == null) {
    next.instructions = GROK_OUTPUT_RULES;
  }
  return next;
}

function activityTarget(input: Record<string, unknown>): string {
  if (typeof input.query === "string" && input.query.trim()) return input.query.trim();
  if (typeof input.url === "string" && input.url.trim()) return input.url.trim();
  if (typeof input.code === "string" && input.code.trim()) return input.code.trim().replace(/\s+/g, " ").slice(0, 100);
  return typeof input.type === "string" ? input.type : "";
}

// ─── Server-tool activity (SSE sniff via fetch wrap) ─────

function describeServerToolItem(item: Record<string, unknown> | null | undefined): string | null {
  if (!item || typeof item.type !== "string") return null;
  const t = item.type;
  if (t === "function_call" || t === "reasoning" || t === "message" || t === "custom_tool_call") {
    return null;
  }
  if (!t.endsWith("_call") && t !== "mcp_list_tools" && t !== "mcp_approval_request") {
    return null;
  }
  const name = t.endsWith("_call") ? t.slice(0, -"_call".length) : t;
  let detail = "";
  const action = item.action as Record<string, unknown> | undefined;
  if (action && typeof action === "object") {
    if (typeof action.query === "string" && action.query.trim()) {
      detail = `: ${action.query.trim().slice(0, 120)}`;
    } else if (typeof action.url === "string" && action.url.trim()) {
      detail = `: ${action.url.trim().slice(0, 120)}`;
    } else if (Array.isArray(action.queries) && action.queries.length) {
      detail = `: ${String(action.queries[0]).slice(0, 120)}`;
    }
  }
  if (!detail && typeof item.code === "string" && item.code.trim()) {
    detail = `: ${item.code.trim().replace(/\s+/g, " ").slice(0, 100)}`;
  }
  if (!detail && typeof item.server_label === "string") {
    detail = `: ${item.server_label}`;
  }
  return `${name}${detail}`;
}

function publishActivity(line: string, fullLog: string) {
  const g = globalThis as Record<string, unknown>;
  g.__grokNativeToolLast = line;
  g.__grokNativeToolLog = fullLog;
}

type UiSink = {
  setStatus?: (key: string, value?: string) => void;
  notify?: (message: string, level?: "info" | "warning" | "error") => void;
  emitServerToolActivity?: (activity: {
    phase: "start" | "done";
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    output?: string;
  }) => void;
};

type SinkRegistration = {
  getUi: () => UiSink | null;
  isActive: () => boolean;
  appendEntry: (customType: string, data: unknown) => void;
};

function sinkRegistry(): Map<string, SinkRegistration> {
  const g = globalThis as typeof globalThis & { __grokNativeToolSinks?: Map<string, SinkRegistration> };
  if (!g.__grokNativeToolSinks) g.__grokNativeToolSinks = new Map();
  return g.__grokNativeToolSinks;
}

function requestSessionId(input: RequestInfo | URL, init?: RequestInit): string | null {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get("session_id") || headers.get("x-client-request-id");
}

function installFetchSniffer() {
  const g = globalThis as typeof globalThis & {
    fetch: typeof fetch;
    __grokNativeFetchWrapped?: boolean;
  };
  if (g.__grokNativeFetchWrapped) return;
  g.__grokNativeFetchWrapped = true;

  const originalFetch = g.fetch.bind(g);

  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    const sessionId = requestSessionId(input, init);
    const registration = sessionId ? sinkRegistry().get(sessionId) : undefined;
    if (!registration?.isActive()) return response;

    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;

    // Only Responses API streams
    if (!/\/responses(\?|$)/.test(url) && !url.includes("/v1/responses")) {
      return response;
    }

    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream") || !response.body) {
      return response;
    }

    const [forClient, forSniff] = response.body.tee();
    void sniffSse(forSniff, registration);

    return new Response(forClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

async function sniffSse(body: ReadableStream<Uint8Array>, registration: SinkRegistration) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullLog = "";
  const seen = new Set<string>();

  const note = (phase: "start" | "done", item: Record<string, unknown>) => {
    const desc = describeServerToolItem(item);
    if (!desc) return;
    const mark = phase === "start" ? "→" : "✓";
    const line = `${mark} ${desc}`;
    const itemId = String(item.id || item.call_id || desc);
    const key = `${phase}:${itemId}`;
    if (seen.has(key)) return;
    seen.add(key);

    fullLog = fullLog ? `${fullLog}\n${line}` : line;
    publishActivity(line, fullLog);

    const ui = registration.getUi();
    try {
      const rawType = String(item.type || "server_tool");
      const toolName = rawType.endsWith("_call") ? rawType.slice(0, -"_call".length) : rawType;
      const toolCallId = itemId;
      const action = item.action && typeof item.action === "object"
        ? item.action as Record<string, unknown>
        : {};
      const input = Object.keys(action).length > 0
        ? action
        : typeof item.code === "string"
          ? { code: item.code }
          : typeof item.server_label === "string"
            ? { server_label: item.server_label }
            : {};
      const activity = {
        phase,
        toolCallId,
        toolName,
        input,
        output: phase === "done" ? "Completed" : undefined,
      } as const;
      ui?.emitServerToolActivity?.(activity);
      registration.appendEntry(GROK_SERVER_TOOL_ENTRY, {
        ...activity,
        recordedAt: Date.now(),
      });
    } catch {
      // UI may be unavailable mid-shutdown
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events separated by blank line
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseEvent(chunk, note);
      }
      // also handle \r\n\r\n
      while ((idx = buffer.indexOf("\r\n\r\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 4);
        handleSseEvent(chunk, note);
      }
    }
    if (buffer.trim()) handleSseEvent(buffer, note);
  } catch {
    // stream aborted / cancelled — fine
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function handleSseEvent(
  raw: string,
  note: (phase: "start" | "done", item: Record<string, unknown>) => void,
) {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return;
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return;

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }

  const type = typeof evt.type === "string" ? evt.type : "";
  if (type === "response.output_item.added" && evt.item && typeof evt.item === "object") {
    note("start", evt.item as Record<string, unknown>);
  } else if (type === "response.output_item.done" && evt.item && typeof evt.item === "object") {
    note("done", evt.item as Record<string, unknown>);
  }
}

// ─── Extension entry ─────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const g = globalThis as Record<string, unknown>;
  g.__grokNativeToolsActive = false;
  g.__grokNativeToolsLabel = GROK_NATIVE_TOOLS_LABEL;
  g.__grokNativeToolLast = "";
  g.__grokNativeToolLog = "";

  let grokActive = false;
  let uiRef: UiSink | null = null;
  let sessionId = "";

  pi.registerEntryRenderer<{
    phase?: "start" | "done";
    toolName?: string;
    input?: Record<string, unknown>;
  }>(GROK_SERVER_TOOL_ENTRY, (entry, _options, theme) => {
    const data = entry.data;
    if (data?.phase !== "done") return undefined;
    const toolName = data.toolName === "web_search" ? "Web Search" : data.toolName || "Server Tool";
    const target = activityTarget(data.input ?? {});
    const suffix = target ? ` · ${target}` : "";
    return new Text(theme.fg("muted", `✓ ${toolName}${suffix}`), 0, 0);
  });

  const setActiveFlag = (model?: { id?: string; provider?: string } | null) => {
    grokActive = isGrokModel(model);
    g.__grokNativeToolsActive = grokActive;
  };

  installFetchSniffer();

  const registerSink = (ctx: { sessionManager: { getSessionId(): string } }) => {
    sessionId = ctx.sessionManager.getSessionId();
    sinkRegistry().set(sessionId, {
      getUi: () => uiRef,
      isActive: () => grokActive,
      appendEntry: (customType, data) => pi.appendEntry(customType, data),
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    uiRef = ctx.ui;
    registerSink(ctx);
    setActiveFlag(ctx.model);
    // Badge is drawn by kumoSleeping-jina-bar only — clear any leftover setStatus line
    ctx.ui.setStatus?.("grok-native-tools", undefined);
  });

  pi.on("model_select", (event: ModelSelectEvent, ctx) => {
    uiRef = ctx.ui;
    setActiveFlag(event.model);
    if (!grokActive) {
      g.__grokNativeToolLast = "";
      g.__grokNativeToolLog = "";
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    uiRef = ctx.ui;
    g.__grokNativeToolLast = "";
    g.__grokNativeToolLog = "";
    if (!isGrokModel(ctx.model)) return;
    grokActive = true;
  });

  pi.on("session_shutdown", async () => {
    if (sessionId) sinkRegistry().delete(sessionId);
  });

  pi.on("before_provider_request", (event, ctx) => {
    uiRef = ctx.ui;
    registerSink(ctx);
    if (!isGrokModel(ctx.model)) {
      g.__grokNativeToolsActive = false;
      grokActive = false;
      return;
    }
    grokActive = true;
    g.__grokNativeToolsActive = true;
    return injectNativeTools(event.payload);
  });
}
