import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCallRecord } from "../types";
import { projectAssistantTurn } from "./assistantTurnState";

function tool(id: string, toolName = "web_search"): ToolCallRecord {
  return { toolCallId: id, toolName, input: {}, status: "done" };
}

function assistant(id: string, blocks: ChatMessage["blocks"], timestamp: number): ChatMessage {
  return { id, role: "assistant", content: "", blocks, timestamp };
}

describe("projectAssistantTurn", () => {
  it("keeps Grok narration in process and transitions at the first answer marker", () => {
    const messages = [
      assistant("work", [
        { type: "thinking", text: "分析" },
        { type: "tool", tool: tool("search-1") },
      ], 1_000),
      assistant("answer", [{ type: "text", text: "正在展开报道细节。# 今日结论" }], 9_000),
    ];

    const projection = projectAssistantTurn(messages, true);
    expect(projection.phase).toBe("answering");
    expect(projection.answerStartedAt).toBe(9_000);
    expect(projection.items).toContainEqual({ kind: "narration", text: "正在展开报道细节。" });
    expect(projection.texts).toEqual([{ key: "answer-text-0", text: "# 今日结论" }]);
  });

  it("never reclassifies answer text when later tools arrive", () => {
    const prefix = [
      assistant("work", [{ type: "tool", tool: tool("search-1") }], 1_000),
      assistant("answer", [{
        type: "text",
        text: "已经确认",
        textSignature: '{"v":1,"id":"answer-1","phase":"final_answer"}',
      }], 2_000),
    ];
    const before = projectAssistantTurn(prefix, true);
    const after = projectAssistantTurn([
      ...prefix,
      assistant("late-tool", [{ type: "tool", tool: tool("search-2") }], 3_000),
      assistant("answer-2", [{ type: "text", text: "，这是结论。" }], 4_000),
    ], true);

    expect(after.texts[0]).toEqual(before.texts[0]);
    expect(after.texts.map((item) => item.text).join("")).toBe("已经确认，这是结论。");
    expect(after.items.filter((item) => item.kind === "tool")).toHaveLength(2);
    expect(after.phase).toBe("answering");
  });

  it("produces the same projection for live and restored blocks", () => {
    const messages = [
      assistant("a1", [
        { type: "thinking", text: "检查来源" },
        { type: "tool", tool: tool("search-1") },
      ], 1_000),
      { ...assistant("a2", [{ type: "text", text: "最终答案" }], 8_000), stopReason: "stop" },
    ];

    const live = projectAssistantTurn(messages, true);
    const history = projectAssistantTurn(messages, false);
    expect(history.items).toEqual(live.items);
    expect(history.texts).toEqual(live.texts);
    expect(history.answerStartedAt).toBe(live.answerStartedAt);
    expect(history.processEndedAt).toBe(live.processEndedAt);
    expect(history.phase).toBe("complete");
  });

  it("uses DeepSeek toolUse and stop reasons without content heuristics", () => {
    const messages = [
      {
        ...assistant("search", [
          { type: "thinking", text: "检索资料" },
          { type: "tool", tool: tool("deepseek-search", "parallel_search_web") },
        ], 1_000),
        stopReason: "toolUse",
      },
      {
        ...assistant("final", [{ type: "text", text: "最终结论" }], 6_000),
        stopReason: "stop",
      },
    ];

    const projection = projectAssistantTurn(messages, true);
    expect(projection.phase).toBe("answering");
    expect(projection.texts).toEqual([{ key: "final-text-0", text: "最终结论" }]);
    expect(projection.items).toHaveLength(2);
  });
});
