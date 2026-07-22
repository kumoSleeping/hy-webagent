import type { ChatMessage, ContentBlock } from "../types";
import { groupBlocksForDisplay, type ActivityItem, type DisplayBlock } from "./blockGrouping";

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

function splitProcessPreamble(text: string): { processText: string; answerText: string } | null {
  const boundary = /(?:^|[\r\n]|[。！？.!?]\s+)(?=#{1,6}[ \t]+|```(?:summary)?\b)/m.exec(text);
  if (!boundary) return null;
  const answerStart = boundary.index + boundary[0].length;
  if (answerStart === 0) return null;
  const processText = text.slice(0, answerStart).trim();
  const answerText = text.slice(answerStart).trimStart();
  return processText && answerText ? { processText, answerText } : null;
}

/**
 * Flatten consecutive assistant messages into one Working process + answer texts.
 */
export function buildAssistantTurnView(
  messages: ChatMessage[],
  agentRunning = false,
): AssistantTurnView {
  const items: ActivityItem[] = [];
  const texts: { key: string; text: string }[] = [];
  const images: NonNullable<ChatMessage["images"]> = [];
  const errors: string[] = [];
  let isStreaming = agentRunning;

  const rawBlocks = messages.map(resolveBlocks);
  const flattened = rawBlocks.flat();
  let finalTextMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (rawBlocks[index]?.some((block) => block.type === "text" && block.text.trim())) {
      finalTextMessageIndex = index;
      break;
    }
  }
  let lastToolIndex = -1;
  for (let index = flattened.length - 1; index >= 0; index -= 1) {
    const block = flattened[index]!;
    if (block.type === "tool") {
      lastToolIndex = index;
      break;
    }
  }
  let blockOffset = 0;
  const displayBlocks = rawBlocks.map((blocks, messageIndex) => {
    const mapped = blocks.flatMap<DisplayBlock>((block, index) => {
      if (block.type !== "text") return [block];
      const belongsToProcess =
        messageIndex < finalTextMessageIndex ||
        (lastToolIndex >= 0 && blockOffset + index < lastToolIndex);
      if (belongsToProcess) return [{ type: "process_text", text: block.text }];
      if (messageIndex === finalTextMessageIndex) {
        const split = splitProcessPreamble(block.text);
        if (split) {
          return [
            { type: "process_text", text: split.processText },
            { type: "text", text: split.answerText },
          ];
        }
      }
      return [block];
    });
    blockOffset += blocks.length;
    return mapped;
  });

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!;
    if (message.isStreaming) isStreaming = true;
    if (message.images?.length) images.push(...message.images);
    if (message.error?.trim()) errors.push(message.error.trim());

    const units = groupBlocksForDisplay(displayBlocks[messageIndex]!, !!message.isStreaming);
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
  const lastBlocks = last ? displayBlocks.at(-1)! : [];
  const needsPending =
    !!last?.isStreaming &&
    lastBlocks.length === 0 &&
    !items.some((item) => item.kind === "thinking" && !item.text);

  if (needsPending) {
    items.push({ kind: "thinking", text: "" });
  }

  // The process timer stops when final answer text begins. ProcessTrace keeps
  // its own expansion state, so stopping the timer never auto-collapses it.
  const processActive = isStreaming && items.length > 0 && texts.length === 0;
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
