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
  it("transitions to answering on the first visible answer character", () => {
    const messages = [
      assistant("work", [
        { type: "thinking", text: "分析" },
        { type: "tool", tool: tool("search-1") },
      ], 1_000),
      assistant("answer", [{ type: "text", text: "结" }], 9_000),
    ];

    const projection = projectAssistantTurn(messages, true);
    expect(projection.phase).toBe("answering");
    expect(projection.answerStartedAt).toBe(9_000);
    expect(projection.texts).toEqual([{ key: "answer-text-0", text: "结" }]);
  });

  it("never reclassifies answer text when later tools arrive", () => {
    const prefix = [
      assistant("work", [{ type: "tool", tool: tool("search-1") }], 1_000),
      assistant("answer", [{ type: "text", text: "已经确认" }], 2_000),
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
      assistant("a2", [{ type: "text", text: "最终答案" }], 8_000),
    ];

    const live = projectAssistantTurn(messages, true);
    const history = projectAssistantTurn(messages, false);
    expect(history.items).toEqual(live.items);
    expect(history.texts).toEqual(live.texts);
    expect(history.answerStartedAt).toBe(live.answerStartedAt);
    expect(history.phase).toBe("complete");
  });
});
