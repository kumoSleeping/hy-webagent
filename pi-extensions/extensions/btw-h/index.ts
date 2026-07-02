/**
 * btw — /btw one-shot side question (TUI + Web)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Message,
  streamSimple,
  type UserMessage,
} from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionEntry,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey } from "@earendil-works/pi-tui";

const BTW_COMMAND = "btw";
const BTW_WIDGET_KEY = "btw";
const MAX_VISIBLE = 12;

const BTW_SYSTEM_PROMPT = readFileSync(
  fileURLToPath(new URL("./prompts/btw-system.txt", import.meta.url)),
  "utf-8",
).trimEnd();

// ── Helpers ───────────────────────────────────────────────
function branchToMessages(branch: SessionEntry[]): Message[] {
  return convertToLlm(
    branch.filter((e): e is SessionEntry & { type: "message" } => e.type === "message").map((e) => e.message),
  );
}

function assistantText(msg: AssistantMessage): string {
  return msg.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
}

function isTui(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui";
}

// ── Web panel (plain strings) ─────────────────────────────
function showWeb(ctx: ExtensionCommandContext, lines: string[]) {
  ctx.ui.setWidget(BTW_WIDGET_KEY, lines, { placement: "aboveEditor" });
}

function dismissWeb(ctx: ExtensionCommandContext) {
  ctx.ui.setWidget(BTW_WIDGET_KEY, undefined);
}

// ── TUI panel (Markdown + keyboard) ───────────────────────
interface Panel {
  visible: boolean;
  scroll: number;
  text: string;
  unsub: (() => void) | null;
  rr: (() => void) | null;
  md: Markdown | null;
}

function mkPanel(): Panel {
  return { visible: false, scroll: 0, text: "", unsub: null, rr: null, md: null };
}

function showTui(ctx: ExtensionCommandContext, p: Panel, md: string) {
  p.text = md;
  p.scroll = 0;

  if (!p.visible) {
    p.visible = true;

    p.unsub = ctx.ui.onTerminalInput((data) => {
      if (!p.visible) return;
      if (matchesKey(data, "escape"))     { dismissTui(ctx, p); return { consume: true }; }
      if (matchesKey(data, "up"))         { p.scroll = Math.max(0, p.scroll - 1); p.rr?.(); return { consume: true }; }
      if (matchesKey(data, "down"))       { p.scroll += 1; p.rr?.(); return { consume: true }; }
      if (matchesKey(data, "pageUp"))     { p.scroll = Math.max(0, p.scroll - MAX_VISIBLE); p.rr?.(); return { consume: true }; }
      if (matchesKey(data, "pageDown"))   { p.scroll += MAX_VISIBLE; p.rr?.(); return { consume: true }; }
      if (matchesKey(data, "home"))       { p.scroll = 0; p.rr?.(); return { consume: true }; }
      if (matchesKey(data, "end"))        { p.scroll = Number.MAX_SAFE_INTEGER; p.rr?.(); return { consume: true }; }
    });

    ctx.ui.setWidget(BTW_WIDGET_KEY, (_tui, theme) => {
      p.rr = () => _tui.requestRender();
      p.md = new Markdown(p.text, 1, 0, getMarkdownTheme());
      return {
        render(w: number): string[] {
          if (!p.visible || !p.md) return [];
          const all = p.md.render(w);
          const maxOff = Math.max(0, all.length - MAX_VISIBLE);
          p.scroll = Math.max(0, Math.min(p.scroll, maxOff));
          const vis = all.slice(p.scroll, p.scroll + MAX_VISIBLE);
          const first = p.scroll + 1;
          const last = Math.min(p.scroll + MAX_VISIBLE, all.length);
          const pct = all.length > 0 ? Math.round((last / all.length) * 100) : 100;
          return [...vis, theme.fg("dim", `─ ESC close · ↑↓ scroll · ${first}-${last}/${all.length} (${pct}%)`)];
        },
        invalidate() { p.md?.invalidate(); },
      };
    }, { placement: "aboveEditor" });
    return;
  }

  p.md?.setText(md);
  p.rr?.();
}

function dismissTui(ctx: ExtensionCommandContext, p: Panel) {
  p.visible = false;
  p.md = null;
  p.rr = null;
  p.unsub?.();
  p.unsub = null;
  ctx.ui.setWidget(BTW_WIDGET_KEY, undefined);
}

// ── Core ──────────────────────────────────────────────────
async function run(q: string, ctx: ExtensionCommandContext, p: Panel) {
  const model = ctx.model;
  if (!model) { ctx.ui.notify("/btw requires an active model", "error"); return; }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) { ctx.ui.notify("/btw: no API key", "error"); return; }

  const msgs: Message[] = [
    ...branchToMessages(ctx.sessionManager.getBranch() as SessionEntry[]),
    { role: "user", content: [{ type: "text", text: q }], timestamp: Date.now() } as UserMessage,
  ];

  const evs = streamSimple(
    model,
    { systemPrompt: BTW_SYSTEM_PROMPT, messages: msgs, tools: [] },
    { apiKey: auth.apiKey, headers: auth.headers },
  );

  if (isTui(ctx)) {
    await runTui(q, ctx, p, evs);
  } else {
    await runWeb(q, ctx, evs);
  }
}

async function runWeb(q: string, ctx: ExtensionCommandContext, evs: AssistantMessageEventStream) {
  showWeb(ctx, [`Q: ${q}`, "…"]);
  const THROTTLE_MS = 100;
  let lastRender = 0;
  let acc = "";
  try {
    for await (const ev of evs) {
      if (ev.type === "text_delta") {
        acc += ev.delta;
        const now = Date.now();
        if (now - lastRender >= THROTTLE_MS) {
          showWeb(ctx, [`Q: ${q}`, acc ? `A: ${acc}` : "…"]);
          lastRender = now;
        }
      } else if (ev.type === "error") {
        showWeb(ctx, [`Q: ${q}`, `✗ ${ev.error.errorMessage ?? ev.error.stopReason ?? "stream error"}`]);
        return;
      }
    }
    const answer = acc.trim();
    showWeb(ctx, [`Q: ${q}`, answer ? `A: ${answer}` : "✗ empty response"]);
  } catch (err) {
    showWeb(ctx, [`Q: ${q}`, `✗ ${err instanceof Error ? err.message : String(err)}`]);
  }
}

async function runTui(q: string, ctx: ExtensionCommandContext, p: Panel, evs: AssistantMessageEventStream) {
  showTui(ctx, p, `**Q:** ${q}\n\n> Thinking…`);
  let acc = "";
  try {
    for await (const ev of evs) {
      if (!p.visible) break;
      if (ev.type === "text_delta") {
        acc += ev.delta;
        showTui(ctx, p, `**Q:** ${q}\n\n${acc}`);
      } else if (ev.type === "error") {
        showTui(ctx, p, `**Q:** ${q}\n\n> ⚠ ${ev.error.errorMessage ?? "stream error"}`);
        return;
      }
    }
  } catch (err) {
    showTui(ctx, p, `**Q:** ${q}\n\n> ⚠ ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!p.visible) return;

  let resp: AssistantMessage;
  try { resp = await evs.result(); } catch { return; }
  if (resp.stopReason !== "stop") return;

  const answer = assistantText(resp).trim();
  if (!answer) {
    showTui(ctx, p, `**Q:** ${q}\n\n> ⚠ empty response`);
    return;
  }
  showTui(ctx, p, `**Q:** ${q}\n\n${answer}`);
}

// ── Extension ─────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  const panel = mkPanel();

  pi.registerCommand(BTW_COMMAND, {
    description: "Ask a one-shot side question (ESC to close, ↑↓ to scroll)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) { ctx.ui.notify("/btw requires interactive UI", "error"); return; }
      const q = args.trim();
      if (!q) { ctx.ui.notify("Usage: /btw <question>", "warning"); return; }
      if (isTui(ctx) && panel.visible) dismissTui(ctx, panel);
      await run(q, ctx, panel);
    },
  });
}
