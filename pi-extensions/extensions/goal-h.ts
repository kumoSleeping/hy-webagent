/**
 * goal-manager-lite
 *
 * 目标文件: 每个 session 隔离，基于 session JSONL 路径派生
 * 工具: goal_manager (set / update / complete)
 * autoContinue 始终开启
 * 第一行必须是具体任务目标，不能是记忆/知识库标题
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function loadGoal(p: string): string | null {
  if (!existsSync(p)) return null;
  try { return readFileSync(p, "utf-8").trim() || null; } catch { return null; }
}

function saveGoal(p: string, content: string): string | null {
  writeFileSync(p, content, "utf-8");
  return content.trim() || null;
}

function clearGoal(p: string): void {
  try { unlinkSync(p); } catch { /* ok */ }
}

// 标题校验: 拒绝记忆/知识库类标题
const BAD_TITLE_RE = /^(?:project memories?|memories|memory|readme|context|project notes?|notes|reference|index|toc|summary|知识库|记忆|备忘|笔记|记录|项目记录|参考|索引|目录|摘要)\s*$/i;

function validateTitle(content: string): string | null {
  const firstLine = content.split("\n")[0]?.trim() || "";
  if (!firstLine.startsWith("# ")) {
    return `First line must start with "# ". Got: "${firstLine.slice(0, 60)}"`;
  }
  const title = firstLine.replace(/^#\s+/, "").trim();
  if (!title) return "Goal title is empty";
  if (BAD_TITLE_RE.test(title)) {
    return `"${title}" is a memory/knowledge heading, not a goal. Use a specific task objective, e.g. "# Fix file preview shadow jitter".`;
  }
  if (title.length < 3) return `Title "${title}" is too short`;
  return null;
}

interface BarInfo {
  title: string;
  done: number;
  total: number;
  notes: string;
  isSisyphus: boolean;
}

function parseBar(content: string | null): BarInfo {
  const text = content ?? "";
  const lines = text.split("\n");
  const title = lines[0]?.replace(/^#\s+/, "").trim() || "";
  const isSisyphus = /@sisyphus/i.test(text);
  let done = 0, failed = 0;
  for (const line of lines) {
    if (/^##\s/.test(line)) continue;
    const m = line.match(/^\s*\[(x| )\]/i);
    if (m) { if (m[1] === "x") done++; else failed++; }
  }
  const checkboxTotal = done + failed;
  const sectionCount = lines.filter((l) => /^##\s/.test(l)).length;
  const notesIdx = lines.findIndex((l) => /^##\s*⚠️/.test(l));
  let notes = "";
  if (notesIdx >= 0) {
    notes = lines.slice(notesIdx + 1)
      .filter((l) => l.startsWith("-") || l.startsWith("*"))
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean).join(" | ");
  }
  return { title: title || (text ? "Untitled" : ""), done, total: checkboxTotal > 0 ? checkboxTotal : sectionCount, notes, isSisyphus };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    // 派生 session 隔离的 goal 路径
    const goalPath = sessionFile ? sessionFile.replace(/\.jsonl$/, "-goal.md") : null;
    if (!goalPath) return; // ephemeral (print mode) — skip

    let goalContent: string | null = null;
    let hasDoneWork = false;
    let requestRender: (() => void) | null = null;
    goalContent = loadGoal(goalPath);

    pi.registerTool({
      name: "goal_manager",
      label: "Goal Manager",
      description:
        "Manage goal.md (set/update/complete). Format: # Title, ## sections with [x]/[ ] checkboxes, ## ⚠️ for constraints. Title must be a concrete task objective, not a knowledge-base heading (no 'Project Memories', 'README', 'Context', etc.).",
      promptSnippet: "Manage goal.md: set, update, or complete the current project goal",
      promptGuidelines: [
        "Use goal_manager to create/update/complete goal.md.",
        "The # title must be a specific task objective. Never use memory/knowledge headings like 'Project Memories', 'README', or 'Context'.",
        "When setting a goal, include a ## ⚠️ section for user constraints.",
        "After progress, use update to refresh checkboxes and notes.",
        "Only complete when ALL requirements are done. File will be deleted.",
        "If @sisyphus is present, follow steps strictly in order.",
      ],
      parameters: Type.Object({
        mode: Type.String({ description: "'set', 'update', or 'complete'" }),
        content: Type.Optional(Type.String({ description: "Full Markdown for goal.md. Required for set/update." })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _execCtx) {
        const mode = params.mode?.toLowerCase() ?? "";
        if (mode === "set" || mode === "update") {
          if (!params.content) {
            return { content: [{ type: "text", text: `goal_manager ${mode}: content is required.` }], details: {}, isError: true };
          }
          const err = validateTitle(params.content);
          if (err) {
            return { content: [{ type: "text", text: `goal_manager ${mode}: ${err}` }], details: {}, isError: true };
          }
          goalContent = saveGoal(goalPath, params.content);
          const bar = parseBar(goalContent);
          requestRender?.();
          const prog = bar.total > 0 ? ` [${bar.done}/${bar.total}]` : "";
          return {
            content: [{ type: "text", text: `${mode === "set" ? "Goal set" : "Goal updated"}: ${bar.title}${prog}` }],
            details: { mode, ...bar },
          };
        }
        if (mode === "complete") {
          const bar = parseBar(goalContent);
          clearGoal(goalPath);
          goalContent = null;
          requestRender?.();
          return {
            content: [{ type: "text", text: `Goal complete: ${bar.title || "done"} — goal.md cleared.` }],
            details: { mode: "complete", previousTitle: bar.title },
          };
        }
        return {
          content: [{ type: "text", text: `Unknown mode "${mode}". Use set, update, or complete.` }],
          details: {},
          isError: true,
        };
      },
    });

    ctx.ui.setWidget("goal-bar", (_tui, theme) => {
      return { render: () => [], invalidate() {} };
    }, { placement: "belowEditor" });

    pi.on("turn_start", () => { hasDoneWork = false; });
    pi.on("tool_call", async (event) => {
      const workTools = new Set(["bash", "edit", "write"]);
      if (workTools.has(event.toolName)) {
        const input = event.input as Record<string, unknown> | undefined;
        if (event.toolName === "bash") {
          hasDoneWork = !/^\s*echo\b/.test(typeof input?.command === "string" ? input.command : "");
        } else {
          hasDoneWork = true;
        }
      }
    });
    pi.on("agent_end", async () => {
      goalContent = loadGoal(goalPath);
      if (!goalContent || !hasDoneWork) return;
      const prompt = [
        "[GOAL CONTINUATION]",
        "Current goal (goal.md):",
        "```markdown",
        goalContent.slice(0, 2000),
        "```",
        "Continue working. Use goal_manager to update or complete.",
      ].join("\n");
      pi.sendMessage({ customType: "goal-continuation", content: prompt, display: false }, { triggerTurn: true, deliverAs: "followUp" });
    });
    pi.on("before_agent_start", async (event) => {
      const g = loadGoal(goalPath);
      if (g && /@sisyphus/i.test(g)) {
        return {
          systemPrompt: (event.systemPrompt ?? "") +
            "\n\n[SISYPHUS] Follow steps strictly in order; do not skip, merge, or reorder.",
        };
      }
    });
    pi.on("session_shutdown", () => { goalContent = null; requestRender = null; });
    requestRender?.();
  });
}
