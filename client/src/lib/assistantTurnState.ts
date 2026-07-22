import type { ChatMessage, ContentBlock } from "../types";

export type ActivityItem =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: import("../types").ToolCallRecord };

export type AssistantTurnPhase = "working" | "answering" | "complete";

export interface AssistantTurnProjection {
  phase: AssistantTurnPhase;
  items: ActivityItem[];
  texts: { key: string; text: string }[];
  answerStartedAt: number | null;
}

function resolveBlocks(message: ChatMessage): ContentBlock[] {
  if (message.blocks?.length) return message.blocks;
  if (message.toolCalls?.length) {
    return message.toolCalls.map((tool) => ({ type: "tool" as const, tool }));
  }
  return message.content.trim() ? [{ type: "text", text: message.content }] : [];
}

/**
 * Forward-only projection of one assistant run.
 *
 * A block receives its display role from its own event type. Later tools never
 * reclassify or relocate text that has already been shown as answer content.
 */
export function projectAssistantTurn(
  messages: ChatMessage[],
  agentRunning: boolean,
): AssistantTurnProjection {
  const items: ActivityItem[] = [];
  const texts: { key: string; text: string }[] = [];
  let phase: AssistantTurnPhase = "working";
  let answerStartedAt: number | null = null;

  for (const message of messages) {
    const blocks = resolveBlocks(message);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (block.type === "text") {
        if (!block.text.trim()) continue;
        if (phase === "working") {
          phase = "answering";
          answerStartedAt = message.timestamp;
        }
        texts.push({ key: `${message.id}-text-${index}`, text: block.text });
      } else if (block.type === "thinking") {
        if (block.text || phase === "working") {
          items.push({ kind: "thinking", text: block.text });
        }
      } else {
        items.push({ kind: "tool", tool: block.tool });
      }
    }
  }

  if (phase === "working" && agentRunning && items.length === 0) {
    items.push({ kind: "thinking", text: "" });
  }
  if (!agentRunning) phase = "complete";

  return { phase, items, texts, answerStartedAt };
}
