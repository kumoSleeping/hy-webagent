import type { ContentBlock, ToolCallRecord } from "../types";
import { getToolCategory, type ToolCategory } from "./toolDisplay";

/** One block inside a collapsed activity group, kept in original arrival order. */
export type ActivityItem =
  | { kind: "thinking"; text: string }
  | { kind: "status"; text: string }
  | { kind: "tool"; tool: ToolCallRecord };

export type DisplayBlock = ContentBlock | { type: "process_text"; text: string };

/**
 * Render-time projection of a message's raw `blocks` into display units.
 *
 * The store keeps blocks in true arrival order (text / thinking / tool,
 * interleaved exactly as the agent produced them). This function derives,
 * purely from that array plus whether the message is still streaming, how
 * they should be *presented*:
 *
 * - Everything the agent does before it actually says something — thinking
 *   and tool calls alike — is one continuous "Working process" activity.
 *   Only a real `text` block (an actual answer) or the turn ending closes it.
 * - While that activity is still the tail of a streaming message, it stays
 *   open (`isActive`) so the UI can expand the live step and collapse prior
 *   ones as the agent moves on.
 * - Once it closes (answer arrives, or history replay), the whole stretch
 *   collapses under a single "Working process" toggle. Expanding reveals the
 *   exact same individual steps in arrival order.
 *
 * This is a pure function of (blocks, isStreaming), so it produces the same
 * grouping whether it's called on a message that's live-streaming right now
 * or one replayed from history — no separate "post-process on load" path.
 */
export type DisplayUnit =
  | { kind: "text"; key: string; text: string }
  | {
      kind: "activity";
      key: string;
      items: ActivityItem[];
      toolCount: number;
      category: ToolCategory | null;
      /** True while this activity is the live streaming tail. */
      isActive: boolean;
      /** Index of the currently live step within `items`, or null when closed. */
      activeIndex: number | null;
    };

export function groupBlocksForDisplay(blocks: DisplayBlock[], isStreaming: boolean): DisplayUnit[] {
  const units: DisplayUnit[] = [];
  let pending: ActivityItem[] = [];

  function flushPending(isTail: boolean) {
    if (pending.length === 0) return;
    const isActive = isTail && isStreaming;
    const toolCount = pending.filter((item): item is { kind: "tool"; tool: ToolCallRecord } => item.kind === "tool").length;
    const tools = pending
      .filter((item): item is { kind: "tool"; tool: ToolCallRecord } => item.kind === "tool")
      .map((item) => item.tool);
    const categories = new Set(tools.map((t) => getToolCategory(t.toolName)));
    const category: ToolCategory | null = categories.size === 1 ? [...categories][0]! : null;
    const anchorId = tools[0]?.toolCallId ?? `p${units.length}`;
    units.push({
      kind: "activity",
      key: `activity-${anchorId}`,
      items: pending,
      toolCount,
      category,
      isActive,
      activeIndex: isActive ? pending.length - 1 : null,
    });
    pending = [];
  }

  blocks.forEach((block, i) => {
    const isLast = i === blocks.length - 1;
    if (block.type === "text") {
      // Empty/whitespace placeholders must not split one Working process into
      // many — only a real answer closes the activity stretch.
      if (!block.text.trim()) {
        if (isLast) flushPending(true);
        return;
      }
      flushPending(false);
      units.push({ kind: "text", key: `text-${i}`, text: block.text });
      return;
    }
    pending.push(
      block.type === "tool"
        ? { kind: "tool", tool: block.tool }
        : block.type === "process_text"
          ? { kind: "status", text: block.text }
          : { kind: "thinking", text: block.text }
    );
    if (isLast) flushPending(true);
  });

  // Nothing has arrived yet — the agent is still working even if no
  // thinking tokens are visible (e.g. a non-thinking model warming up).
  if (blocks.length === 0 && isStreaming) {
    units.push({
      kind: "activity",
      key: "activity-pending",
      items: [{ kind: "thinking", text: "" }],
      toolCount: 0,
      category: null,
      isActive: true,
      activeIndex: 0,
    });
  }

  return units;
}
