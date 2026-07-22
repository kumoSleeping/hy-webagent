import type { ChatMessage, ContentBlock } from "../types";

export type ActivityItem =
  | { kind: "thinking"; text: string }
  | { kind: "narration"; text: string }
  | { kind: "tool"; tool: import("../types").ToolCallRecord };

export type AssistantTurnPhase = "working" | "answering" | "complete";

export interface AssistantTurnProjection {
  phase: AssistantTurnPhase;
  items: ActivityItem[];
  texts: { key: string; text: string }[];
  answerStartedAt: number | null;
  processEndedAt: number | null;
}

function textPhase(signature?: string): "commentary" | "final_answer" | null {
  if (!signature?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(signature) as { v?: unknown; phase?: unknown };
    if (parsed.v === 1 && (parsed.phase === "commentary" || parsed.phase === "final_answer")) {
      return parsed.phase;
    }
  } catch {
    return null;
  }
  return null;
}

function splitAnswerBoundary(text: string): { narration: string; answer: string } | null {
  const marker = /(?:^|[\r\n]|[。！？.!?]\s*)(?=#{1,6}[ \t]+|```summary\b)/m.exec(text);
  if (!marker) return null;
  const answerStart = marker.index + marker[0].length;
  return {
    narration: text.slice(0, answerStart).trim(),
    answer: text.slice(answerStart).trimStart(),
  };
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
  let processEndedAt: number | null = null;
  let hasProcessContext = false;

  for (const message of messages) {
    const blocks = resolveBlocks(message);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (block.type === "text") {
        if (!block.text.trim()) continue;
        if (phase === "answering") {
          texts.push({ key: `${message.id}-text-${index}`, text: block.text });
          continue;
        }

        const signaturePhase = textPhase(block.textSignature);
        const boundary = splitAnswerBoundary(block.text);
        const completedPlainAnswer =
          message.stopReason === "stop" || message.stopReason === "length";
        const isImmediateAnswer =
          signaturePhase === "final_answer" ||
          (!hasProcessContext && signaturePhase !== "commentary" && message.stopReason !== "toolUse") ||
          completedPlainAnswer;

        if (signaturePhase === "commentary") {
          items.push({ kind: "narration", text: block.text });
          hasProcessContext = true;
          processEndedAt = Math.max(processEndedAt ?? 0, message.timestamp);
        } else if (boundary && boundary.answer) {
          if (boundary.narration) {
            items.push({ kind: "narration", text: boundary.narration });
            hasProcessContext = true;
            processEndedAt = Math.max(processEndedAt ?? 0, message.timestamp);
          }
          phase = "answering";
          answerStartedAt = message.timestamp;
          texts.push({ key: `${message.id}-text-${index}`, text: boundary.answer });
        } else if (isImmediateAnswer) {
          phase = "answering";
          answerStartedAt = message.timestamp;
          texts.push({ key: `${message.id}-text-${index}`, text: block.text });
        } else {
          items.push({ kind: "narration", text: block.text });
          hasProcessContext = true;
          processEndedAt = Math.max(processEndedAt ?? 0, message.timestamp);
        }
      } else if (block.type === "thinking") {
        if (block.text || phase === "working") {
          items.push({ kind: "thinking", text: block.text });
          hasProcessContext = true;
          processEndedAt = Math.max(processEndedAt ?? 0, message.timestamp);
        }
      } else {
        items.push({ kind: "tool", tool: block.tool });
        hasProcessContext = true;
        processEndedAt = Math.max(processEndedAt ?? 0, message.timestamp);
      }
    }
  }

  if (phase === "working" && agentRunning && items.length === 0) {
    items.push({ kind: "thinking", text: "" });
  }
  if (!agentRunning) phase = "complete";

  return { phase, items, texts, answerStartedAt, processEndedAt };
}
