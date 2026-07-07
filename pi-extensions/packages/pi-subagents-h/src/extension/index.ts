/**
 * pi-subagents-h — general-purpose subagent for pi
 *
 * Spawns an isolated child pi process with full tools. The main agent
 * describes the task in natural language — explore code, search the web,
 * implement features, run tests, whatever is needed.
 *
 * Multiple subagent calls can be dispatched in parallel — each runs
 * in an independent child process.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SubagentParams } from "./schemas.ts";
import { runSubagent } from "../runs/execution.ts";
import { SUBAGENT_CHILD_ENV } from "../shared/types.ts";

// ── helpers ────────────────────────────────────────────

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function statusIcon(result: { interrupted?: boolean; exitCode: number }): string {
  return result.interrupted ? "⏱" : result.exitCode === 0 ? "✓" : "✗";
}

function clipTask(task: string, maxLen = 120): string {
  const singleLine = task.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen) + "…";
}

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

function getCurrentModel(ctx: ExtensionContext): string | undefined {
  const model = (ctx as any).model;
  if (!model) return undefined;
  if (typeof model === "string") return model;
  if (model.provider && model.id) return `${model.provider}/${model.id}`;
  return undefined;
}

// ── subagent config ────────────────────────────────────

/** Full toolset — the subagent can do anything the task requires. */
const SUBAGENT_TOOLS = "read,grep,find,ls,bash,edit,write,parallel_search_web,read_url";

/** xhigh thinking gives the subagent thorough reasoning for complex tasks. */
const SUBAGENT_THINKING = "xhigh";

// ── extension ──────────────────────────────────────────

export default function register(pi: ExtensionAPI): void {
  if (process.env[SUBAGENT_CHILD_ENV] === "1") return;

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "通用子代理，独立进程中执行任务。配备完整工具集（文件读写、bash、网络搜索），" +
      "默认使用当前 PIA 会话模型。适合派发独立子任务以保持主线思维不中断。",
    promptSnippet: "通用子代理（独立进程 / 完整工具 / xhigh 思考）",
    promptGuidelines: [
      "子代理适合：探索代码结构、搜索网络信息、写代码改文件、运行测试和命令。",
      "核心原则：凡是会让主线思维分叉、引入大量无关上下文、或纯粹执行性的工作，丢给子代理。",
      "执行落地：你保持思考流不中断，让子代理去干活，最后只看结论。",
      "提示：task 写得越具体（文件路径、搜索关键词、期望输出格式），子代理越高效。",
      "⚡ 并行：可以同时派发多个子代理处理不同子任务，它们独立进程运行，互不干扰。",
      "",
      "使用策略：",
      "• 简单、单一的问题 — 自己去解决，不要派子代理（减少开销）。",
      "• 复合问题需要多路探索 — 派多个子代理并行，例如一个搜网络文档 + 一个搜本地代码。",
      "• 需要同时修改多个精细位置 — 每个位置丢一个子代理并行改。",
      "• 信息收集 + 代码修改混搭 — 搜网络和改代码的子代理并行派发。",
      "",
      "模型选择（通过 model 参数指定，默认与你相同）：",
      "• 简单文件探索、grep 搜索 → Deepseek Flash（deepseek/deepseek-v4-flash），便宜够用。",
      "• 网络搜索、信息收集 → Deepseek Pro（deepseek/deepseek-v4-pro），需要较强理解能力。",
      "• 写代码、重构、跑测试等复杂任务 → 与你相同的模型，保持一致。",
      "• 不确定时优先选 Deepseek 系列，不指定 model 则默认与你相同。",
      "",
      "一句话：单线程自己来，多线程用子代理；轻活 Flash，搜活 Pro，重活同模。",
    ],

    parameters: SubagentParams,

    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const model = (params as any).model || getCurrentModel(ctx);
        if (!model) {
          throw new Error("No active model in the current session. Select a model with /model first.");
        }

        const result = await runSubagent({
          task: (params as any).task,
          model,
          thinking: SUBAGENT_THINKING,
          tools: SUBAGENT_TOOLS,
          cwd: ctx.cwd,
          signal,
          timeoutMs: (params as any).timeoutMs,
        });

        const icon = statusIcon(result);
        const tok = formatTokens(result.usage.input + result.usage.output);
        const header = `## ${icon} subagent · ${model} (${result.usage.turns}t, ${tok} tok)`;
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
        theme.fg("toolTitle", theme.bold("subagent")) +
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
