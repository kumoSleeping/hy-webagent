import type { ContentBlock, ToolCallRecord } from "../types";
import { getToolCategory, type ToolCategory } from "./toolDisplay";

/** One block inside a collapsed activity group, kept in original arrival order. */
export type ActivityItem =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: ToolCallRecord };

/**
 * Render-time projection of a message's raw `blocks` into display units.
 *
 * The store keeps blocks in true arrival order (text / thinking / tool,
 * interleaved exactly as the agent produced them). This function derives,
 * purely from that array plus whether the message is still streaming, how
 * they should be *presented*:
 *
 * - Everything the agent does before it actually says something — thinking
 *   and tool calls alike, however many times it pauses to think in between
 *   tool calls — is one continuous "activity": from the user's point of
 *   view it's all just "the agent is working". Only a real `text` block (an
 *   actual answer) or the turn ending closes it.
 * - While that activity is still the tail of a streaming message, it's
 *   shown exactly as it happens: one card per tool, thinking segments
 *   expanded live.
 * - Once it closes, a run with 2+ tool calls collapses into a single expandable
 *   group card labeled by what kind of work it was (e.g. "Web" if every
 *   tool call in it was a web tool, "Tools" for local work), with the tool
 *   count shown right on the badge. Expanding it reveals the exact same
 *   individual cards (and any thinking toggles) in the same order. A closed
 *   run with only one tool call — even if thinking segments came before it
 *   — stays as plain cards so a lone read/bash doesn't get an extra wrapper.
 *
 * This is a pure function of (blocks, isStreaming), so it produces the same
 * grouping whether it's called on a message that's live-streaming right now
 * or one replayed from history — no separate "post-process on load" path.
 */
export type DisplayUnit =
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string; isActive: boolean }
  | { kind: "tool"; key: string; tool: ToolCallRecord }
  | { kind: "activity"; key: string; items: ActivityItem[]; toolCount: number; category: ToolCategory | null };

export function groupBlocksForDisplay(blocks: ContentBlock[], isStreaming: boolean): DisplayUnit[] {
  const units: DisplayUnit[] = [];
  let pending: ActivityItem[] = [];

  function flushPending(isTail: boolean) {
    if (pending.length === 0) return;
    const isOpenRun = isTail && isStreaming;
    const toolCount = pending.filter((item): item is { kind: "tool"; tool: ToolCallRecord } => item.kind === "tool").length;

    if (isOpenRun || pending.length === 1 || toolCount <= 1) {
      pending.forEach((item, idx) => {
        if (item.kind === "tool") {
          units.push({ kind: "tool", key: `tool-${item.tool.toolCallId}`, tool: item.tool });
        } else {
          units.push({
            kind: "thinking",
            key: `think-${units.length}-${idx}`,
            text: item.text,
            // Only the very last item of a still-open run is the live one.
            isActive: isOpenRun && idx === pending.length - 1,
          });
        }
      });
    } else {
      const tools = pending
        .filter((item): item is { kind: "tool"; tool: ToolCallRecord } => item.kind === "tool")
        .map((item) => item.tool);
      const categories = new Set(tools.map((t) => getToolCategory(t.toolName)));
      const category: ToolCategory | null = categories.size === 1 ? [...categories][0]! : null;
      const anchorId = tools[0]?.toolCallId ?? `p${units.length}`;
      units.push({ kind: "activity", key: `activity-${anchorId}`, items: pending, toolCount: tools.length, category });
    }
    pending = [];
  }

  blocks.forEach((block, i) => {
    const isLast = i === blocks.length - 1;
    if (block.type === "text") {
      flushPending(false);
      units.push({ kind: "text", key: `text-${i}`, text: block.text });
      return;
    }
    pending.push(block.type === "tool" ? { kind: "tool", tool: block.tool } : { kind: "thinking", text: block.text });
    if (isLast) flushPending(true);
  });

  // Nothing has arrived yet — the agent is still "thinking" even if no
  // thinking tokens are visible (e.g. a non-thinking model warming up).
  if (blocks.length === 0 && isStreaming) {
    units.push({ kind: "thinking", key: "think-pending", text: "", isActive: true });
  }

  return units;
}
