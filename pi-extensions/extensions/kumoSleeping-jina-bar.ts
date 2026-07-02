/**
 * kumoSleeping-jina-bar — Timer + Jina Stats + Goal Status
 *
 * Single bar: timer | jina | goal title [x/y] | @kumoSleeping
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolveJinaApiKey } from "./_lib/jina-auth.ts";

const SIGNATURE = "@kumoSleeping";

function formatMs(ms: number): string {
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m${sec % 60}s`;
}

function formatTokens(n: number): string {
  if (n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return `${n}`;
}

async function fetchBalance(apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch("https://r.jina.ai", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    const m = text.match(/\[Balance left\]\s+(\d+)/);
    if (m) return formatTokens(parseInt(m[1], 10));
    return null;
  } catch { return null; }
}

function jinaTokens(): number {
  return ((globalThis as Record<string, unknown>).__jinaTokens as number) || 0;
}

// ── goal.md 解析 (与 goal-h 共享格式) ────────────────────
interface GoalStatus { title: string; done: number; total: number; active: boolean }

function readGoal(p: string | null): GoalStatus | null {
  if (!p) return null;
  try {
    if (!existsSync(p)) return null;
    const text = readFileSync(p, "utf-8").trim();
    if (!text) return null;
    const lines = text.split("\n");
    const title = lines[0]?.replace(/^#\s+/, "").trim() || "";
    let done = 0, failed = 0;
    for (const line of lines) {
      if (/^##\s/.test(line)) continue;
      const m = line.match(/^\s*\[(x| )\]/i);
      if (m) { if (m[1] === "x") done++; else failed++; }
    }
    const total = done + failed || lines.filter((l) => /^##\s/.test(l)).length;
    return { title: title || "Untitled", done, total, active: true };
  } catch { return null; }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const goalPath: string | null = sessionFile ? sessionFile.replace(/\.jsonl$/, "-goal.md") : null;

    let startTime: number | null = null;
    let finalTime: number | null = null;
    let renderInterval: ReturnType<typeof setInterval> | null = null;
    let jinaBalance: string | null = null;
    let requestRender: (() => void) | null = null;

    function clearInterval_() {
      if (renderInterval !== null) { clearInterval(renderInterval); renderInterval = null; }
    }

    ctx.ui.setWidget("timer", (_tui, theme) => {
      requestRender = () => _tui.requestRender();
      const dim = (s: string) => theme.fg("dim", s);
      return {
        render(width: number): string[] {
          const t = jinaTokens();
          const timer = startTime !== null
            ? `⏱ ${formatMs(Date.now() - startTime)}`
            : finalTime !== null
              ? `✓ ${formatMs(finalTime)}`
              : null;

          const jina = t > 0
            ? `Jina △${formatTokens(t)}`
            : jinaBalance
              ? `Jina:${jinaBalance}`
              : null;

          // goal 状态内联 (session 隔离)
          const goal = readGoal(goalPath);
          const goalStr = goal && goal.active
            ? `\u25C9 ${goal.title}${goal.total > 0 ? ` [${goal.done}/${goal.total}]` : ""}`
            : null;

          const parts = [timer, jina, goalStr].filter(Boolean);
          const left = parts.join("  ");

          const gap = Math.max(1, width - left.length - SIGNATURE.length);
          return [dim(left) + "\u00A0".repeat(gap) + theme.fg("error", SIGNATURE)];
        },
        invalidate() {},
      };
    }, { placement: "belowEditor" });

    requestRender?.();
    void resolveJinaApiKey(ctx.modelRegistry).then((key) => {
      if (!key) return;
      fetchBalance(key).then((b) => { if (b) { jinaBalance = b; requestRender?.(); } });
    });

    pi.on("agent_start", async () => {
      clearInterval_();
      (globalThis as Record<string, unknown>).__jinaTokens = 0;
      startTime = Date.now();
      finalTime = null;
      requestRender?.();
      renderInterval = setInterval(() => requestRender?.(), 250);
    });

    pi.on("agent_end", async () => {
      clearInterval_();
      if (startTime !== null) { finalTime = Date.now() - startTime; startTime = null; }
      requestRender?.();
    });

    pi.on("session_shutdown", async () => {
      clearInterval_();
      startTime = null;
      finalTime = null;
      jinaBalance = null;
      requestRender = null;
    });
  });
}
