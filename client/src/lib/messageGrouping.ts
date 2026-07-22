import type { ChatMessage, ContentBlock } from "../types";
import { groupBlocksForDisplay, type ActivityItem } from "./blockGrouping";

/** One row in the chat feed after coalescing consecutive assistant turns. */
export type FeedItem =
  | { kind: "user"; key: string; message: ChatMessage }
  | { kind: "assistant_turn"; key: string; messages: ChatMessage[] };

/**
 * Collapse consecutive assistant messages into one feed item.
 *
 * Agent tool loops emit one assistant message per step (tool burst → next
 * tool burst → final answer). The UI should show a single "Working process"
 * for the whole stretch between user turns, not one header per message.
 */
export function groupMessagesForFeed(messages: ChatMessage[]): FeedItem[] {
  const items: FeedItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role === "user") {
      items.push({ kind: "user", key: msg.id, message: msg });
      i += 1;
      continue;
    }

    const start = i;
    while (i < messages.length && messages[i]!.role === "assistant") i += 1;
    const run = messages.slice(start, i);
    items.push({
      kind: "assistant_turn",
      key: `turn-${run[0]!.id}`,
      messages: run,
    });
  }
  return items;
}

export type AssistantTurnView = {
  items: ActivityItem[];
  texts: { key: string; text: string }[];
  images: NonNullable<ChatMessage["images"]>;
  /** Provider/API failures attached to any message in the turn. */
  errors: string[];
  isStreaming: boolean;
  processActive: boolean;
  activeIndex: number | null;
  /** Wall-clock span of the turn from first to last assistant message (ms). */
  durationMs: number | null;
  /** Representative message for export / context menu (prefer last with text). */
  exportMessage: ChatMessage;
};

/**
 * Flatten consecutive assistant messages into one Working process + answer texts.
 */
export function buildAssistantTurnView(messages: ChatMessage[]): AssistantTurnView {
  const items: ActivityItem[] = [];
  const texts: { key: string; text: string }[] = [];
  const images: NonNullable<ChatMessage["images"]> = [];
  const errors: string[] = [];
  let isStreaming = false;

  for (const message of messages) {
    if (message.isStreaming) isStreaming = true;
    if (message.images?.length) images.push(...message.images);
    if (message.error?.trim()) errors.push(message.error.trim());

    const blocks = resolveBlocks(message);
    const units = groupBlocksForDisplay(blocks, !!message.isStreaming);
    for (const unit of units) {
      if (unit.kind === "activity") {
        for (const item of unit.items) {
          // Drop empty pending placeholders unless this message is still live —
          // buildAssistantTurnView adds a single live placeholder at the end.
          if (item.kind === "thinking" && !item.text && !message.isStreaming) continue;
          items.push(item);
        }
      } else if (unit.kind === "text" && unit.text.trim()) {
        texts.push({ key: `${message.id}-${unit.key}`, text: unit.text });
      }
    }
  }

  // One live pending step when the latest assistant bubble is streaming with
  // nothing in it yet (warmup between tool rounds).
  const last = messages.at(-1);
  const lastBlocks = last ? resolveBlocks(last) : [];
  const needsPending =
    !!last?.isStreaming &&
    lastBlocks.length === 0 &&
    !items.some((item) => item.kind === "thinking" && !item.text);

  if (needsPending) {
    items.push({ kind: "thinking", text: "" });
  }

  // Process is live while the turn is streaming and no answer text has landed
  // yet on the current (last) message — once the model starts answering, fold.
  const lastHasAnswer =
    !!last &&
    groupBlocksForDisplay(resolveBlocks(last), !!last.isStreaming).some(
      (u) => u.kind === "text" && u.text.trim()
    );
  const processActive = isStreaming && !lastHasAnswer;
  const activeIndex = processActive && items.length > 0 ? items.length - 1 : null;

  const exportMessage =
    [...messages].reverse().find(
      (m) =>
        m.content.trim() ||
        m.error?.trim() ||
        (m.blocks?.some((b) => b.type === "text" && b.text.trim()))
    ) ?? messages[messages.length - 1]!;

  const startedAt = messages[0]?.timestamp ?? null;
  const endedAt = messages[messages.length - 1]?.timestamp ?? null;
  const durationMs =
    !processActive && startedAt != null && endedAt != null
      ? Math.max(0, endedAt - startedAt)
      : null;

  return { items, texts, images, errors, isStreaming, processActive, activeIndex, durationMs, exportMessage };
}

function resolveBlocks(message: ChatMessage): ContentBlock[] {
  if (message.blocks && message.blocks.length > 0) return message.blocks;
  // Legacy: toolCalls only
  if (message.toolCalls?.length) {
    return message.toolCalls.map((tool) => ({ type: "tool" as const, tool }));
  }
  if (message.content.trim()) {
    return [{ type: "text", text: message.content }];
  }
  return [];
}

/** Format elapsed working time for the collapsed Working process label. */
export function formatProcessDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}
