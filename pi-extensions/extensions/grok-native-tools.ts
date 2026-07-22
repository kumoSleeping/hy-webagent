/**
 * grok-native-tools — Inject + surface xAI server-side tools (extension only).
 *
 * - before_provider_request: inject native tools when model is Grok
 * - fetch wrapper: parse Responses SSE for web_search_call / x_search_call / …
 *   and show them via setWorkingMessage + globalThis (bar badge is kumoSleeping-jina-bar)
 *
 * Bar badge: "grok-native-tools ✓" (Grok only, drawn by kumoSleeping-jina-bar)
 * Rotating working/thinking message: "hyw?" (+ tool activity while searching)
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

/** Exported for status bar / other extensions. */
export const GROK_NATIVE_TOOLS = [
  { type: "web_search" },
  { type: "x_search" },
  { type: "code_interpreter" },
  { type: "view_image" },
  { type: "view_x_video" },
] as const;

/** Bottom status bar — keep in sync with kumoSleeping-jina-bar.ts */
export const GROK_NATIVE_TOOLS_LABEL = "grok-native-tools ✓";

/** Rotating working/thinking spinner text (short; not the bar label). */
export const HYW_WORKING_LABEL = "hyw?";

function isGrokModel(model?: { id?: string; provider?: string } | null): boolean {
  if (!model) return false;
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
  return next;
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
  setWorkingMessage?: (message?: string) => void;
  notify?: (message: string, level?: "info" | "warning" | "error") => void;
};

function installFetchSniffer(getUi: () => UiSink | null, isActive: () => boolean) {
  const g = globalThis as typeof globalThis & {
    fetch: typeof fetch;
    __grokNativeFetchWrapped?: boolean;
  };
  if (g.__grokNativeFetchWrapped) return;
  g.__grokNativeFetchWrapped = true;

  const originalFetch = g.fetch.bind(g);

  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

    if (!isActive()) return response;

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
    void sniffSse(forSniff, getUi);

    return new Response(forClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

async function sniffSse(body: ReadableStream<Uint8Array>, getUi: () => UiSink | null) {
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
    const key = `${phase}:${desc}`;
    if (seen.has(key)) return;
    seen.add(key);

    fullLog = fullLog ? `${fullLog}\n${line}` : line;
    publishActivity(line, fullLog);

    const ui = getUi();
    try {
      // Bottom status stays static; only the rotating thinking/working line updates
      ui?.setWorkingMessage?.(`${HYW_WORKING_LABEL} ${line}`);
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

  const setActiveFlag = (model?: { id?: string; provider?: string } | null) => {
    grokActive = isGrokModel(model);
    g.__grokNativeToolsActive = grokActive;
  };

  installFetchSniffer(
    () => uiRef,
    () => grokActive,
  );

  pi.on("session_start", async (_event, ctx) => {
    uiRef = ctx.ui;
    setActiveFlag(ctx.model);
    // Badge is drawn by kumoSleeping-jina-bar only — clear any leftover setStatus line
    ctx.ui.setStatus?.("grok-native-tools", undefined);
  });

  pi.on("model_select", (event: ModelSelectEvent, ctx) => {
    uiRef = ctx.ui;
    setActiveFlag(event.model);
    if (!grokActive) {
      ctx.ui.setWorkingMessage?.();
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    uiRef = ctx.ui;
    g.__grokNativeToolLast = "";
    g.__grokNativeToolLog = "";
    if (!isGrokModel(ctx.model)) return;
    grokActive = true;
    // Spinner only (hyw); footer badge comes from the bar widget
    ctx.ui.setWorkingMessage?.(HYW_WORKING_LABEL);
  });

  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.setWorkingMessage?.();
  });

  pi.on("before_provider_request", (event, ctx) => {
    uiRef = ctx.ui;
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
