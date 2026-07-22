import { describe, it, expect } from "vitest";
import type { ChatMessage, ToolCallRecord } from "../types";
import {
  buildAssistantTurnView,
  formatProcessDuration,
  groupMessagesForFeed,
} from "./messageGrouping";

function tool(id: string, overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return { toolCallId: id, toolName: "bash", input: {}, status: "done", ...overrides };
}

function assistant(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: 1000,
    blocks: [],
    ...overrides,
  };
}

describe("groupMessagesForFeed", () => {
  it("coalesces consecutive assistant messages into one turn", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi", timestamp: 1 },
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10 }),
      assistant("a2", { blocks: [{ type: "tool", tool: tool("t2") }], timestamp: 20 }),
      assistant("a3", { content: "done", blocks: [{ type: "text", text: "done" }], timestamp: 30 }),
      { id: "u2", role: "user", content: "next", timestamp: 40 },
      assistant("a4", { content: "ok", blocks: [{ type: "text", text: "ok" }], timestamp: 50 }),
    ];
    const feed = groupMessagesForFeed(messages);
    expect(feed.map((f) => f.kind)).toEqual(["user", "assistant_turn", "user", "assistant_turn"]);
    expect(feed[1]).toMatchObject({ kind: "assistant_turn" });
    if (feed[1]?.kind === "assistant_turn") {
      expect(feed[1].messages.map((m) => m.id)).toEqual(["a1", "a2", "a3"]);
    }
  });
});

describe("buildAssistantTurnView", () => {
  it("merges tools from every assistant message into one Working process", () => {
    const view = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10_000 }),
      assistant("a2", {
        blocks: [
          { type: "thinking", text: "hmm" },
          { type: "tool", tool: tool("t2") },
        ],
        timestamp: 20_000,
      }),
      assistant("a3", {
        content: "answer",
        blocks: [{ type: "text", text: "answer" }],
        timestamp: 22_000,
      }),
    ]);
    expect(view.items).toHaveLength(3);
    expect(view.texts).toEqual([{ key: "a3-text-0", text: "answer" }]);
    expect(view.errors).toEqual([]);
    expect(view.processActive).toBe(false);
    expect(view.durationMs).toBe(12_000);
  });

  it("marks the process active until the final answer text arrives", () => {
    const live = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10 }),
      assistant("a2", { blocks: [], isStreaming: true, timestamp: 20 }),
    ]);
    expect(live.processActive).toBe(true);
    expect(live.activeIndex).toBe(live.items.length - 1);

    const answering = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10 }),
      assistant("a2", {
        content: "hi",
        blocks: [{ type: "text", text: "hi" }],
        isStreaming: true,
        timestamp: 20,
      }),
    ]);
    expect(answering.processActive).toBe(false);
    expect(answering.activeIndex).toBeNull();
  });

  it("hides search narration before the last web tool and keeps the answer", () => {
    const view = buildAssistantTurnView([
      assistant("a1", {
        content: "正在检索剧情资料。",
        blocks: [{ type: "text", text: "正在检索剧情资料。" }],
      }),
      assistant("a2", {
        blocks: [{
          type: "tool",
          tool: tool("web-1", {
            toolName: "web_search",
            input: { query: "剧情资料" },
          }),
        }],
      }),
      assistant("a3", {
        content: "最终回答",
        blocks: [{ type: "text", text: "最终回答" }],
      }),
    ]);

    expect(view.texts).toEqual([{ key: "a3-text-0", text: "最终回答" }]);
    expect(view.items).toHaveLength(1);
  });
});

describe("formatProcessDuration", () => {
  it("formats seconds and longer spans", () => {
    expect(formatProcessDuration(12_000)).toBe("12s");
    expect(formatProcessDuration(65_000)).toBe("1m 5s");
    expect(formatProcessDuration(3_600_000)).toBe("1h");
  });
});
