/**
 * kumoSleeping-jina-bar — Timer + Jina Stats + Subagent Billing + Goal Status
 *
 * Single bar: timer | jina | subagent | goal title [x/y] | @kumoSleeping
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
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

// ── subagent cost persistence (shared with pi-subagents-h via globalThis) ──

interface SubagentStats {
  tokens: number;
  cost: number;
  calls: number;
  running: number;
}

function loadCostFile(path: string): SubagentStats | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as SubagentStats;
  } catch { return null; }
}

function deleteCostFile(path: string): void {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
}

function restoreSubagentToGlobal(stats: SubagentStats | null): void {
  const g = globalThis as Record<string, unknown>;
  g.__subagentTokens = stats?.tokens ?? 0;
  g.__subagentCost   = stats?.cost   ?? 0;
  g.__subagentCalls  = stats?.calls  ?? 0;
}

function subagentStats(): SubagentStats {
  const g = globalThis as Record<string, unknown>;
  return {
    tokens:  (g.__subagentTokens  as number) || 0,
    cost:    (g.__subagentCost    as number) || 0,
    calls:   (g.__subagentCalls   as number) || 0,
    running: (g.__subagentRunning as number) || 0,
  };
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

    // Session-specific cost file so sessions don't cross-contaminate
    const subagentCostFile = sessionFile
      ? sessionFile.replace(/\.jsonl$/, "-subagent.json")
      : null;
    (globalThis as Record<string, unknown>).__subagentCostFile = subagentCostFile;

    // Restore subagent billing from previous runs in this session
    if (subagentCostFile) {
      restoreSubagentToGlobal(loadCostFile(subagentCostFile));
    }

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

          // subagent billing (from pi-subagents-h)
          const sub = subagentStats();
          let subStr: string | null = null;
          if (sub.tokens > 0 || sub.running > 0) {
            const costStr = sub.cost > 0
              ? `$${sub.cost.toFixed(3)}`
              : `△${formatTokens(sub.tokens)}`;
            if (sub.running > 0) {
              subStr = `Sub ▶${sub.running} ✓${sub.calls} ${costStr}`;
            } else {
              subStr = `Sub ✓${sub.calls} ${costStr}`;
            }
          }

          // goal 状态内联 (session 隔离)
          const goal = readGoal(goalPath);
          const goalStr = goal && goal.active
            ? `\u25C9 ${goal.title}${goal.total > 0 ? ` [${goal.done}/${goal.total}]` : ""}`
            : null;

          const parts = [timer, jina, subStr, goalStr].filter(Boolean);
          const left = dim(parts.join("  "));
          const sigColored = theme.fg("error", SIGNATURE);
          const sigWidth = visibleWidth(sigColored);
          const maxLeft = Math.max(0, width - sigWidth - 1);
          const leftTruncated = truncateToWidth(left, maxLeft, dim("..."), false);
          const leftWidth = visibleWidth(leftTruncated);
          const gap = Math.max(1, width - leftWidth - sigWidth);
          return [leftTruncated + "\u00A0".repeat(gap) + sigColored];
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
      // Only reset Jina per agent-run; subagent totals persist across runs within the session
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
      const g = globalThis as Record<string, unknown>;
      g.__jinaTokens = 0;
      g.__subagentTokens = 0;
      g.__subagentCost = 0;
      g.__subagentCalls = 0;
      g.__subagentRunning = 0;
      // Clean up persisted cost file for this session
      if (subagentCostFile) deleteCostFile(subagentCostFile);
      startTime = null;
      finalTime = null;
      jinaBalance = null;
      requestRender = null;
    });
  });
}
