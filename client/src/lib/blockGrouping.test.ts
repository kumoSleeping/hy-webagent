import { describe, it, expect } from "vitest";
import { groupBlocksForDisplay } from "./blockGrouping";
import type { ContentBlock, ToolCallRecord } from "../types";

function tool(id: string, overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return { toolCallId: id, toolName: "bash", input: {}, status: "done", ...overrides };
}

describe("groupBlocksForDisplay", () => {
  it("shows a single trailing tool call ungrouped while streaming", () => {
    const runningTool = tool("a", { status: "running" });
    const blocks: ContentBlock[] = [{ type: "tool", tool: runningTool }];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units).toEqual([{ kind: "tool", key: "tool-a", tool: runningTool }]);
  });

  it("keeps an open run of thinking + tool calls ungrouped while it is still the active tail", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "hmm" },
      { type: "tool", tool: tool("a") },
      { type: "thinking", text: "still going" },
      { type: "tool", tool: tool("b", { status: "running" }) },
    ];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units.map((u) => u.kind)).toEqual(["thinking", "tool", "thinking", "tool"]);
    // only the very last item of the still-open run is "active"
    expect(units[0]).toMatchObject({ isActive: false });
    expect(units[2]).toMatchObject({ isActive: false });
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
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 2 });
    expect((units[0] as { items: unknown[] }).items).toHaveLength(4);
    expect(units[1]).toMatchObject({ kind: "text", text: "done" });
  });

  it("does not group a closed run of thinking plus a single tool", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "let me look" },
      { type: "tool", tool: tool("a", { toolName: "read" }) },
      { type: "text", text: "done" },
    ];
    const units = groupBlocksForDisplay(blocks, false);
    expect(units.map((u) => u.kind)).toEqual(["thinking", "tool", "text"]);
  });

  it("does not group a closed run of exactly one item", () => {
    const blocks: ContentBlock[] = [{ type: "tool", tool: tool("a") }, { type: "text", text: "ok" }];
    const units = groupBlocksForDisplay(blocks, true);
    expect(units[0]).toMatchObject({ kind: "tool" });
  });

  it("closes and collapses the trailing run once streaming ends", () => {
    const blocks: ContentBlock[] = [{ type: "tool", tool: tool("a") }, { type: "tool", tool: tool("b") }];
    const units = groupBlocksForDisplay(blocks, false);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "activity", toolCount: 2 });
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

  it("marks the trailing thinking segment active only while streaming", () => {
    const blocks: ContentBlock[] = [{ type: "thinking", text: "hmm" }];
    expect(groupBlocksForDisplay(blocks, true)[0]).toMatchObject({ kind: "thinking", isActive: true });
    expect(groupBlocksForDisplay(blocks, false)[0]).toMatchObject({ kind: "thinking", isActive: false });
  });

  it("surfaces a pending 'thinking' placeholder when nothing has arrived yet", () => {
    const units = groupBlocksForDisplay([], true);
    expect(units).toEqual([{ kind: "thinking", key: "think-pending", text: "", isActive: true }]);
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
