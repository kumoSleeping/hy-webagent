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

  it("keeps the process active across assistant/tool boundaries for the whole agent run", () => {
    const live = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10 }),
      assistant("a2", { blocks: [], timestamp: 20 }),
    ], true);
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
    ], true);
    expect(answering.processActive).toBe(false);
    expect(answering.activeIndex).toBeNull();

    const finished = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("t1") }], timestamp: 10 }),
      assistant("a2", { content: "hi", blocks: [{ type: "text", text: "hi" }], timestamp: 20 }),
    ]);
    expect(finished.processActive).toBe(false);
    expect(finished.activeIndex).toBeNull();
  });

  it("keeps text stable as answer content when a later tool arrives", () => {
    const view = buildAssistantTurnView([
      assistant("a1", {
        content: "正在检索剧情资料。",
        blocks: [{ type: "text", text: "正在检索剧情资料。" }],
      }),
      assistant("a2", {
        blocks: [{
          type: "tool",
          tool: tool("web-1", {
            toolName: "bash",
            input: { command: "echo ready" },
          }),
        }],
      }),
      assistant("a3", {
        content: "最终回答",
        blocks: [{ type: "text", text: "最终回答" }],
      }),
    ]);

    expect(view.texts).toEqual([
      { key: "a1-text-0", text: "正在检索剧情资料。" },
      { key: "a3-text-0", text: "最终回答" },
    ]);
    expect(view.items).toEqual([expect.objectContaining({ kind: "tool" })]);
  });

  it("collapses the process on the first streamed answer text", () => {
    const view = buildAssistantTurnView([
      assistant("a1", {
        content: "继续核实几条较新的头条报道。",
        blocks: [{ type: "text", text: "继续核实几条较新的头条报道。" }],
      }),
      assistant("a2", {
        content: "# 今日 AI 新闻速览",
        blocks: [{ type: "text", text: "# 今日 AI 新闻速览" }],
        isStreaming: true,
      }),
    ], true);

    expect(view.texts).toEqual([
      { key: "a1-text-0", text: "继续核实几条较新的头条报道。" },
      { key: "a2-text-0", text: "# 今日 AI 新闻速览" },
    ]);
    expect(view.processActive).toBe(false);
  });

  it("never splits one text block with Markdown heuristics", () => {
    const view = buildAssistantTurnView([
      assistant("a1", {
        content: "再核几条重点报道的细节。 # 今日 AI 新闻速览\n\n正文",
        blocks: [{ type: "text", text: "再核几条重点报道的细节。 # 今日 AI 新闻速览\n\n正文" }],
        isStreaming: true,
      }),
    ], true);

    expect(view.items).toEqual([]);
    expect(view.texts).toEqual([{
      key: "a1-text-0",
      text: "再核几条重点报道的细节。 # 今日 AI 新闻速览\n\n正文",
    }]);
    expect(view.processActive).toBe(false);
  });

  it("does not move live text behind a preceding tool", () => {
    const view = buildAssistantTurnView([
      assistant("a1", { blocks: [{ type: "tool", tool: tool("web-1") }] }),
      assistant("a2", {
        content: "I got results; let me verify another source.",
        blocks: [{ type: "text", text: "I got results; let me verify another source." }],
        isStreaming: true,
      }),
    ], true);

    expect(view.items).toEqual([expect.objectContaining({ kind: "tool" })]);
    expect(view.texts).toEqual([{
      key: "a2-text-0",
      text: "I got results; let me verify another source.",
    }]);
    expect(view.processActive).toBe(false);
  });
});

describe("formatProcessDuration", () => {
  it("formats seconds and longer spans", () => {
    expect(formatProcessDuration(12_000)).toBe("12s");
    expect(formatProcessDuration(65_000)).toBe("1m 5s");
    expect(formatProcessDuration(3_600_000)).toBe("1h");
  });
});
