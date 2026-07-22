import { describe, it, expect } from "vitest";
import { groupBlocksForDisplay } from "./blockGrouping";
import type { ContentBlock, ToolCallRecord } from "../types";

function tool(id: string, overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return { toolCallId: id, toolName: "bash", input: {}, status: "done", ...overrides };
}

describe("groupBlocksForDisplay", () => {
  it("wraps a single trailing tool call in an active Working process while streaming", () => {
    const runningTool = tool("a", { status: "running" });
    const blocks: ContentBlock[] = [{ type: "tool", tool: runningTool }];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units).toEqual([
      {
        kind: "activity",
        key: "activity-a",
        items: [{ kind: "tool", tool: runningTool }],
        toolCount: 1,
        category: "tools",
        isActive: true,
        activeIndex: 0,
      },
    ]);
  });

  it("keeps an open run of thinking + tool calls as one active Working process", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "hmm" },
      { type: "tool", tool: tool("a") },
      { type: "thinking", text: "still going" },
      { type: "tool", tool: tool("b", { status: "running" }) },
    ];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      kind: "activity",
      isActive: true,
      activeIndex: 3,
      toolCount: 2,
    });
    expect((units[0] as { items: unknown[] }).items).toHaveLength(4);
  });

  it("collapses a closed run of thinking + tool calls into one activity, even with pauses to think in between", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "let me look" },
      { type: "tool", tool: tool("a") },
      { type: "thinking", text: "now let me check this" },
      { type: "tool", tool: tool("b") },
      { type: "text", text: "done" },
    ];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 2, isActive: false, activeIndex: null });
    expect((units[0] as { items: unknown[] }).items).toHaveLength(4);
    expect(units[1]).toMatchObject({ kind: "text", text: "done" });
  });

  it("still groups a closed run of thinking plus a single tool under Working process", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "let me look" },
      { type: "tool", tool: tool("a", { toolName: "read" }) },
      { type: "text", text: "done" },
    ];
    const units = groupBlocksForDisplay(blocks, false);
    expect(units.map((u) => u.kind)).toEqual(["activity", "text"]);
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 1, isActive: false });
  });

  it("groups a closed run of exactly one tool under Working process", () => {
    const blocks: ContentBlock[] = [{ type: "tool", tool: tool("a") }, { type: "text", text: "ok" }];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 1, isActive: false, activeIndex: null });
  });

  it("closes the trailing run once streaming ends", () => {
    const blocks: ContentBlock[] = [{ type: "tool", tool: tool("a") }, { type: "tool", tool: tool("b") }];
    const units = groupBlocksForDisplay(blocks, false);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 2, isActive: false, activeIndex: null });
  });

  it("labels a group by tool category when every tool call in it shares one", () => {
    const webBlocks: ContentBlock[] = [
      { type: "tool", tool: tool("a", { toolName: "read_url" }) },
      { type: "tool", tool: tool("b", { toolName: "parallel_search_web" }) },
    ];
    expect(groupBlocksForDisplay(webBlocks, false)[0]).toMatchObject({ kind: "activity", category: "web" });

    const localBlocks: ContentBlock[] = [
      { type: "tool", tool: tool("a", { toolName: "bash" }) },
      { type: "tool", tool: tool("b", { toolName: "read" }) },
    ];
    expect(groupBlocksForDisplay(localBlocks, false)[0]).toMatchObject({ kind: "activity", category: "tools" });

    const mixedBlocks: ContentBlock[] = [
      { type: "tool", tool: tool("a", { toolName: "bash" }) },
      { type: "tool", tool: tool("b", { toolName: "read_url" }) },
    ];
    expect(groupBlocksForDisplay(mixedBlocks, false)[0]).toMatchObject({ kind: "activity", category: null });
  });

  it("marks a lone thinking segment active only while streaming", () => {
    const blocks: ContentBlock[] = [{ type: "thinking", text: "hmm" }];
    expect(groupBlocksForDisplay(blocks, true)[0]).toMatchObject({
      kind: "activity",
      isActive: true,
      activeIndex: 0,
    });
    expect(groupBlocksForDisplay(blocks, false)[0]).toMatchObject({
      kind: "activity",
      isActive: false,
      activeIndex: null,
    });
  });

  it("surfaces a pending Working process when nothing has arrived yet", () => {
    const units = groupBlocksForDisplay([], true);
    expect(units).toEqual([
      {
        kind: "activity",
        key: "activity-pending",
        items: [{ kind: "thinking", text: "" }],
        toolCount: 0,
        category: null,
        isActive: true,
        activeIndex: 0,
      },
    ]);
  });

  it("renders nothing for an empty, finished message", () => {
    expect(groupBlocksForDisplay([], false)).toEqual([]);
  });

  it("keeps text output outside any activity grouping", () => {
    const blocks: ContentBlock[] = [
      { type: "tool", tool: tool("a") },
      { type: "tool", tool: tool("b") },
      { type: "text", text: "first answer" },
      { type: "tool", tool: tool("c") },
      { type: "tool", tool: tool("d") },
    ];
    const units = groupBlocksForDisplay(blocks, false);
    expect(units.map((u) => u.kind)).toEqual(["activity", "text", "activity"]);
  });
});
