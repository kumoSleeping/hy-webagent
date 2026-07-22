import type { ChatMessage } from "../types";
import { projectAssistantTurn, type ActivityItem } from "./assistantTurnState";

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
export function buildAssistantTurnView(
  messages: ChatMessage[],
  agentRunning = false,
): AssistantTurnView {
  const images: NonNullable<ChatMessage["images"]> = [];
  const errors: string[] = [];
  const turnRunning = agentRunning || messages.some((message) => !!message.isStreaming);
  let isStreaming = turnRunning;
  const projection = projectAssistantTurn(messages, turnRunning);

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]!;
    if (message.isStreaming) isStreaming = true;
    if (message.images?.length) images.push(...message.images);
    if (message.error?.trim()) errors.push(message.error.trim());
  }
  const { items, texts } = projection;
  const processActive = isStreaming && projection.phase === "working" && items.length > 0;
  const activeIndex = processActive ? items.length - 1 : null;

  const exportMessage =
    [...messages].reverse().find(
      (m) =>
        m.content.trim() ||
        m.error?.trim() ||
        (m.blocks?.some((b) => b.type === "text" && b.text.trim()))
    ) ?? messages[messages.length - 1]!;

  const startedAt = messages[0]?.timestamp ?? null;
  const endedAt = projection.processEndedAt ?? projection.answerStartedAt ?? messages[messages.length - 1]?.timestamp ?? null;
  const durationMs =
    !processActive && startedAt != null && endedAt != null
      ? Math.max(0, endedAt - startedAt)
      : null;

  return { items, texts, images, errors, isStreaming, processActive, activeIndex, durationMs, exportMessage };
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
