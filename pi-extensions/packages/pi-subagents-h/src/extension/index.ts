/**
 * pi-subagents-h — minimal worker subagent for pi
 *
 * One tool: subagent_worker
 * Spawns a child pi process to execute implementation tasks.
 * Uses the same model as the current session unless overridden.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { WorkerParams } from "./schemas.ts";
import { runSubagent } from "../runs/execution.ts";
import { SUBAGENT_CHILD_ENV } from "../shared/types.ts";

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export default function register(pi: ExtensionAPI): void {
  if (process.env[SUBAGENT_CHILD_ENV] === "1") return;

  pi.registerTool({
    name: "subagent_worker",
    label: "Worker",
    description:
      "Worker 子代理：派发独立任务给子进程去跑，避免污染主线上下文。有完整文件读写权限。",
    promptSnippet: "派发独立任务给子代理，不污染主线上下文",
    promptGuidelines: [
      "核心原则：让子代理去做和主线不同频的事——凡是会让主线思维分叉、引入大量无关上下文、或纯粹执行性的工作，丢给子代理。",
      "调试排错：你专注分析代码逻辑，让子代理去社区（GitHub Issues、StackOverflow）搜索类似问题的解法。",
      "探索代码库：你专注理解架构和依赖关系，让子代理并行搜索网络文档、最佳实践、known issues。",
      "设计选型：你做 UI/组件设计，让子代理调研更优的技术栈、库的坑、替代方案对比。",
      "追踪线索：你顺着某条线索推理，让子代理去社区帖子里深挖讨论链、版本变更、相关 issue。",
      "执行落地：你保持思考流不中断，让子代理去写代码、改文件、跑测试、跑 lint。",
      "这不是强制的——你自己也能查资料写代码。这是一个提醒：当你可以并行推进、或某一支线会拖慢主线节奏时，把支线丢给子代理。",
    ],

    parameters: WorkerParams,

    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        // Default to current model if none specified
        const model = params.model || (ctx as any).model || undefined;

        const result = await runSubagent({
          task: params.task,
          model,
          cwd: ctx.cwd,
          signal,
          timeoutMs: params.timeoutMs,
        });

        const status = result.interrupted ? "⏱" : result.exitCode === 0 ? "✓" : "✗";
        const tok = formatTokens(result.usage.input + result.usage.output);
        const header = `## ${status} worker (${result.usage.turns}t, ${tok} tok)`;
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

    renderCall(_args) {
      return { render: () => ["worker"] };
    },

    renderResult(result) {
      const text = result.content?.[0]?.text || "";
      return { render: () => text.split("\n") };
    },
  });
}
