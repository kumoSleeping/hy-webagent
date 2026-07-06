/**
 * pi-subagents-h — three specialised subagent workers for pi
 *
 *   subagent_explorer  – defaults to the active session model, xhigh thinking, read-only tools
 *                         Code exploration, architecture analysis, pattern discovery
 *
 *   subagent_searcher  – defaults to the active session model, xhigh thinking, search + read-only tools
 *                         Web research, docs lookup, community answers
 *
 *   subagent_worker    – defaults to the active session model, full read/write tools
 *                         Implementation: write code, edit files, run tests
 *
 * All three tools can be called in parallel — the main agent may dispatch
 * several explorer/search/worker tasks at once for different subtasks.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { WorkerParams, LightWorkerParams } from "./schemas.ts";
import { runSubagent } from "../runs/execution.ts";
import { SUBAGENT_CHILD_ENV } from "../shared/types.ts";

// ── helpers ────────────────────────────────────────────

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function statusIcon(result: { interrupted?: boolean; exitCode: number }): string {
  return result.interrupted ? "⏱" : result.exitCode === 0 ? "✓" : "✗";
}

/** Clip task text for compact display in renderCall. */
function clipTask(task: string, maxLen = 120): string {
  const singleLine = task.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen) + "…";
}

/** Format subagent result text with preview/expand support. */
function formatResultText(rawOutput: string, expanded: boolean, theme: any): string {
  const lines = rawOutput.split("\n");
  const maxLines = expanded ? 200 : 15;
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  let styled = displayLines.map((l) => theme.fg("toolOutput", l)).join("\n");
  if (remaining > 0) {
    styled += "\n" + theme.fg("muted", `... (${remaining} more lines, ctrl+o to expand)`);
  }
  return styled || "(no output)";
}

/** Extract a provider/id string from the active session model. */
function getCurrentModel(ctx: ExtensionContext): string | undefined {
  const model = (ctx as any).model;
  if (!model) return undefined;
  if (typeof model === "string") return model;
  if (model.provider && model.id) return `${model.provider}/${model.id}`;
  return undefined;
}

// ── tool sets ──────────────────────────────────────────

/** Read-only exploration tools — no side effects. */
const EXPLORER_TOOLS = "read,grep,find,ls";

/** Search tools + read-only local tools. */
const SEARCHER_TOOLS = "parallel_search_web,read_url,read,grep,find,ls";

/** Full implementation toolset (no search — worker is for writing code). */
const WORKER_TOOLS = "read,grep,find,ls,bash,edit,write";

// ── default thinking level for explorer/searcher ───────

const EXPLORER_THINKING = "xhigh";
const SEARCHER_THINKING = "xhigh";

// ── extension ──────────────────────────────────────────

export default function register(pi: ExtensionAPI): void {
  if (process.env[SUBAGENT_CHILD_ENV] === "1") return;

  // ── shared prompt guidelines (appended to every tool) ──

  const parallelHint = [
    "⚡ 并行策略：你可以同时调用多个不同类型的子代理（explorer + searcher + worker），",
    "各自独立执行不同方向的任务。它们在独立的进程中运行，互不干扰。",
  ].join(" ");

  // ═══════════════════════════════════════════════════════
  // 1. Explorer — lightweight code exploration
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "subagent_explorer",
    label: "Explorer",
    description:
      "探索者子代理：默认使用当前 PIA 会话的模型，xhigh 思考强度。" +
      "只读工具集（read/grep/find/ls），适合快速探索代码库、理解架构、搜索模式、分析依赖关系。",
    promptSnippet: "轻量代码探索子代理（默认当前模型 / xhigh / 只读）",
    promptGuidelines: [
      "探索者适合：快速浏览代码结构、找出关键文件、理解模块依赖关系、搜索特定模式/用法、对比实现方案。",
      "探索者只有只读工具，不会修改任何文件，放心派发探索任务。",
      parallelHint,
    ],

    parameters: LightWorkerParams,

    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const model = getCurrentModel(ctx);
        if (!model) {
          throw new Error("No active model in the current session. Select a model with /model first.");
        }

        const result = await runSubagent({
          task: params.task,
          model,
          thinking: EXPLORER_THINKING,
          tools: EXPLORER_TOOLS,
          cwd: ctx.cwd,
          signal,
          timeoutMs: params.timeoutMs,
        });

        const icon = statusIcon(result);
        const tok = formatTokens(result.usage.input + result.usage.output);
        const header = `## ${icon} explorer · ${model} (${result.usage.turns}t, ${tok} tok)`;
        const body = result.finalOutput || result.error || "(no output)";

        return {
          content: [{ type: "text", text: `${header}\n\n${body}` }],
          details: { result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
          details: {},
        };
      }
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const task = (args as any).task || "…";
      text.setText(
        theme.fg("toolTitle", theme.bold("explorer")) +
        theme.fg("muted", `  ${clipTask(task)}`),
      );
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const rawOutput = result.content?.[0]?.text || "(no output)";
      text.setText(formatResultText(rawOutput, options.expanded, theme));
      return text;
    },
  });

  // ═══════════════════════════════════════════════════════
  // 2. Searcher — web research specialist
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "subagent_searcher",
    label: "Searcher",
    description:
      "网络搜索者子代理：默认使用当前 PIA 会话的模型，xhigh 思考强度。" +
      "配备搜索工具（parallel_search_web/read_url）+ 只读本地工具，适合网络调研、" +
      "查阅最新文档、搜索社区答案（GitHub Issues/StackOverflow）、交叉验证信息。",
    promptSnippet: "网络搜索子代理（默认当前模型 / xhigh / 搜索+只读）",
    promptGuidelines: [
      "搜索者适合：查阅最新 API 文档、在 GitHub Issues 中搜索类似 bug、StackOverflow 找解决方案、调研技术选型、验证信息。",
      "搜索者只有只读+搜索工具，不会修改文件。适合信息收集类任务。",
      "提示：给搜索者明确的搜索方向（关键词、站点范围、时间范围），效果更好。",
      parallelHint,
    ],

    parameters: LightWorkerParams,

    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const model = getCurrentModel(ctx);
        if (!model) {
          throw new Error("No active model in the current session. Select a model with /model first.");
        }

        const result = await runSubagent({
          task: params.task,
          model,
          thinking: SEARCHER_THINKING,
          tools: SEARCHER_TOOLS,
          cwd: ctx.cwd,
          signal,
          timeoutMs: params.timeoutMs,
        });

        const icon = statusIcon(result);
        const tok = formatTokens(result.usage.input + result.usage.output);
        const header = `## ${icon} searcher · ${model} (${result.usage.turns}t, ${tok} tok)`;
        const body = result.finalOutput || result.error || "(no output)";

        return {
          content: [{ type: "text", text: `${header}\n\n${body}` }],
          details: { result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
          details: {},
        };
      }
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const task = (args as any).task || "…";
      text.setText(
        theme.fg("toolTitle", theme.bold("searcher")) +
        theme.fg("muted", `  ${clipTask(task)}`),
      );
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const rawOutput = result.content?.[0]?.text || "(no output)";
      text.setText(formatResultText(rawOutput, options.expanded, theme));
      return text;
    },
  });

  // ═══════════════════════════════════════════════════════
  // 3. Worker — full implementation agent
  // ═══════════════════════════════════════════════════════

  pi.registerTool({
    name: "subagent_worker",
    label: "Worker",
    description:
      "Worker 子代理：继承主会话的模型和思考强度。" +
      "完整文件读写权限（read/bash/edit/write），适合执行具体的实现任务——" +
      "写代码、改文件、跑测试、跑 lint。",
    promptSnippet: "实现子代理（跟随主模型 / 完整文件权限）",
    promptGuidelines: [
      "Worker 适合：写新文件、修改已有代码、运行测试/shell 命令、格式化/重构代码。",
      "Worker 有 bash 权限，可以运行构建、测试、lint 等开发命令。",
      "核心原则：让子代理去做和主线不同频的事——凡是会让主线思维分叉、引入大量无关上下文、或纯粹执行性的工作，丢给子代理。",
      "执行落地：你保持思考流不中断，让子代理去写代码、改文件、跑测试、跑 lint。",
      parallelHint,
    ],

    parameters: WorkerParams,

    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const model = params.model || getCurrentModel(ctx);
        if (!model) {
          throw new Error("No active model in the current session. Select a model with /model first, or pass model explicitly.");
        }

        const result = await runSubagent({
          task: params.task,
          model,
          tools: WORKER_TOOLS,
          cwd: ctx.cwd,
          signal,
          timeoutMs: params.timeoutMs,
        });

        const icon = statusIcon(result);
        const tok = formatTokens(result.usage.input + result.usage.output);
        const header = `## ${icon} worker · ${model} (${result.usage.turns}t, ${tok} tok)`;
        const body = result.finalOutput || result.error || "(no output)";

        return {
          content: [{ type: "text", text: `${header}\n\n${body}` }],
          details: { result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
          details: {},
        };
      }
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const task = (args as any).task || "…";
      text.setText(
        theme.fg("toolTitle", theme.bold("worker")) +
        theme.fg("muted", `  ${clipTask(task)}`),
      );
      return text;
    },

    renderResult(result, options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const rawOutput = result.content?.[0]?.text || "(no output)";
      text.setText(formatResultText(rawOutput, options.expanded, theme));
      return text;
    },
  });
}
