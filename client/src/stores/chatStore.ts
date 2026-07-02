import { create } from "zustand";
import type { ChatMessage, ChatImageAttachment, ContentBlock, ToolCallRecord } from "../types";
import { formatToolContent, isGarbageToolOutput } from "../lib/toolDisplay";
import {
  fileNameFromAttachmentTags,
  parseHistoryImagePart,
  stripFileAttachmentTags,
} from "../lib/prepareAttachments";

let counter = 0;
function nextId() { return `msg-${++counter}-${Date.now()}`; }

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentAssistantId: string | null;
  /** Steering/follow-up text queued behind the current turn — the model
   * hasn't actually seen these yet, so they're kept out of `messages`
   * until the SDK reports they've actually been dequeued for delivery. */
  queuedSteering: string[];
  queuedFollowUp: string[];

  addUserMessage: (content: string, images?: ChatImageAttachment[]) => void;
  startAssistantMessage: () => string;
  appendTextDelta: (msgId: string, delta: string) => void;
  appendThinkingDelta: (msgId: string, delta: string) => void;
  addToolCall: (msgId: string, tool: ToolCallRecord) => void;
  updateToolCall: (msgId: string, toolCallId: string, output: string) => void;
  endToolCall: (msgId: string, toolCallId: string, isError: boolean, details?: unknown, outputFromEnd?: string) => void;
  finalizeRunningToolCalls: (msgId: string) => void;
  finishAssistantMessage: (msgId: string) => void;
  setStreaming: (v: boolean) => void;
  clearMessages: () => void;
  /** Drop transcript and hydration when switching Pi sessions. */
  resetForSessionChange: () => void;
  /** Pi session id whose transcript (+ deferred UI) is ready to display. */
  hydratedPiSessionId: string | null;
  completeHydration: (piSessionId: string) => void;
  loadHistory: (messages: any[], options?: { agentRunning?: boolean }) => void;
  /** Re-attach streaming UI after reload/reconnect while the server agent still runs. */
  resumeAgentRun: () => void;
  /** Resolve (or create) the assistant bubble that should receive live deltas. */
  ensureStreamingAssistant: () => string;
  /** Reconciles the server's queue snapshot against what we last knew about.
   * Any message(s) that dropped off the *front* of either queue since last
   * time were just actually delivered to the model — those get promoted
   * into the real transcript now (not before). */
  syncQueuedMessages: (steering: string[], followUp: string[]) => void;
  /** Optimistically clears the local queue view right when the user asks to
   * recall queued messages back into the composer — must run *before* the
   * server's own (now-empty) snapshot arrives, otherwise that snapshot would
   * read as "everything just got delivered" and wrongly post them as real
   * messages instead of just handing them back for editing. */
  clearQueuedMessagesLocally: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentAssistantId: null,
  queuedSteering: [],
  queuedFollowUp: [],
  hydratedPiSessionId: null,

  addUserMessage: (content, images) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: "user",
      content,
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  syncQueuedMessages: (steering, followUp) => {
    set((s) => {
      const delivered = (prev: string[], next: string[]) =>
        prev.slice(0, Math.max(0, prev.length - next.length));
      const deliveredTexts = [
        ...delivered(s.queuedSteering, steering),
        ...delivered(s.queuedFollowUp, followUp),
      ];
      if (deliveredTexts.length === 0) {
        return { queuedSteering: steering, queuedFollowUp: followUp };
      }
      const newMessages: ChatMessage[] = deliveredTexts.map((content) => ({
        id: nextId(), role: "user", content, timestamp: Date.now(),
      }));
      return {
        messages: [...s.messages, ...newMessages],
        queuedSteering: steering,
        queuedFollowUp: followUp,
      };
    });
  },

  clearQueuedMessagesLocally: () => set({ queuedSteering: [], queuedFollowUp: [] }),

  startAssistantMessage: () => {
    const id = nextId();
    const msg: ChatMessage = {
      id, role: "assistant", content: "", timestamp: Date.now(),
      toolCalls: [], blocks: [], isStreaming: true,
    };
    set((s) => ({ messages: [...s.messages, msg], isStreaming: true, currentAssistantId: id }));
    return id;
  },

  appendTextDelta: (msgId, delta) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const blocks = m.blocks ?? [];
        const last = blocks.at(-1);
        // extend last text block if it exists, else push new one
        if (last && last.type === "text") {
          return { ...m, content: m.content + delta, blocks: [...blocks.slice(0, -1), { type: "text", text: last.text + delta }] };
        }
        return { ...m, content: m.content + delta, blocks: [...blocks, { type: "text", text: delta }] };
      }),
    }));
  },

  // Thinking segments live inline in `blocks`, in true arrival order, so a
  // "thinking → tool → thinking → tool → text" turn renders (and later
  // regroups) in the order it actually happened instead of being hoisted
  // to the top of the message as one lump.
  appendThinkingDelta: (msgId, delta) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const blocks = m.blocks ?? [];
        const last = blocks.at(-1);
        if (last && last.type === "thinking") {
          return { ...m, blocks: [...blocks.slice(0, -1), { type: "thinking", text: last.text + delta }] };
        }
        return { ...m, blocks: [...blocks, { type: "thinking", text: delta }] };
      }),
    }));
  },

  addToolCall: (msgId, tool) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? {
          ...m,
          toolCalls: [...(m.toolCalls || []), { ...tool, status: "running" as const }],
          blocks: [...(m.blocks ?? []), { type: "tool", tool: { ...tool, status: "running" as const } }],
        } : m
      ),
    }));
  },

  updateToolCall: (msgId, toolCallId, output) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? {
          ...m,
          toolCalls: m.toolCalls?.map((tc) =>
            tc.toolCallId === toolCallId ? { ...tc, output } : tc
          ),
          blocks: (m.blocks ?? []).map((b) =>
            b.type === "tool" && b.tool.toolCallId === toolCallId
              ? { type: "tool", tool: { ...b.tool, output } }
              : b
          ),
        } : m
      ),
    }));
  },

  endToolCall: (msgId, toolCallId, isError, details, outputFromEnd) => {
    const typedDetails = details as Record<string, unknown> | undefined;
    const resultText =
      (typeof outputFromEnd === "string" && outputFromEnd.trim() ? outputFromEnd : "") ||
      formatToolContent(typedDetails?.content ?? typedDetails?.result ?? typedDetails);
    const mergeTool = (tc: ToolCallRecord): ToolCallRecord => {
      if (tc.toolCallId !== toolCallId) return tc;
      const mergedOutput = resultText.trim()
        ? resultText
        : isGarbageToolOutput(tc.output)
          ? ""
          : tc.output;
      return {
        ...tc,
        status: isError ? "error" as const : "done" as const,
        isError,
        details: typedDetails,
        output: mergedOutput || tc.output,
      };
    };
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? {
          ...m,
          toolCalls: m.toolCalls?.map(mergeTool),
          blocks: (m.blocks ?? []).map((b) =>
            b.type === "tool" && b.tool.toolCallId === toolCallId
              ? { type: "tool", tool: mergeTool(b.tool) }
              : b
          ),
        } : m
      ),
    }));
  },

  finalizeRunningToolCalls: (msgId) => {
    const markDone = (tc: ToolCallRecord): ToolCallRecord =>
      tc.status === "running" ? { ...tc, status: "done" as const } : tc;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId
          ? {
              ...m,
              toolCalls: m.toolCalls?.map(markDone),
              blocks: (m.blocks ?? []).map((b) =>
                b.type === "tool" ? { type: "tool", tool: markDone(b.tool) } : b
              ),
            }
          : m
      ),
    }));
  },

  finishAssistantMessage: (msgId) => {
    set((s) => ({
      messages: s.messages.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m),
      isStreaming: false, currentAssistantId: null,
    }));
  },

  setStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [], currentAssistantId: null, queuedSteering: [], queuedFollowUp: [] }),

  resetForSessionChange: () =>
    set({
      messages: [],
      currentAssistantId: null,
      queuedSteering: [],
      queuedFollowUp: [],
      isStreaming: false,
      hydratedPiSessionId: null,
    }),

  completeHydration: (piSessionId) =>
    set((s) =>
      s.hydratedPiSessionId === piSessionId ? s : { hydratedPiSessionId: piSessionId }
    ),

  resumeAgentRun: () => {
    set((s) => {
      if (s.isStreaming && s.currentAssistantId) return s;
      const streaming = s.messages.find((m) => m.isStreaming);
      if (streaming) {
        return { isStreaming: true, currentAssistantId: streaming.id };
      }
      const last = s.messages.at(-1);
      if (last?.role === "assistant") {
        return {
          isStreaming: true,
          currentAssistantId: last.id,
          messages: s.messages.map((m) =>
            m.id === last.id ? { ...m, isStreaming: true } : m
          ),
        };
      }
      const id = nextId();
      const msg: ChatMessage = {
        id, role: "assistant", content: "", timestamp: Date.now(),
        toolCalls: [], blocks: [], isStreaming: true,
      };
      return {
        messages: [...s.messages, msg],
        isStreaming: true,
        currentAssistantId: id,
      };
    });
  },

  ensureStreamingAssistant: () => {
    const s = get();
    if (s.currentAssistantId) return s.currentAssistantId;
    const streaming = s.messages.find((m) => m.isStreaming);
    if (streaming) {
      set({ currentAssistantId: streaming.id, isStreaming: true });
      return streaming.id;
    }
    return get().startAssistantMessage();
  },

  loadHistory: (msgs, options) => {
    const toolResults = new Map<string, { content: unknown; isError?: boolean }>();
    for (const m of msgs) {
      if (m.role === "toolResult" && m.toolCallId) {
        toolResults.set(m.toolCallId, { content: m.content, isError: m.isError });
      }
    }

    const converted: ChatMessage[] = [];
    for (const m of msgs) {
      const role = m.role;
      if (role !== "user" && role !== "assistant") continue;
      let content = "";
      const blocks: ContentBlock[] = [];
      const toolCalls: ToolCallRecord[] = [];
      const images: ChatImageAttachment[] = [];
      let rawTextForTags = "";
      if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === "text") {
            content += p.text;
            rawTextForTags += p.text;
            blocks.push({ type: "text", text: p.text });
          }
          else if (p.type === "thinking") { blocks.push({ type: "thinking", text: p.thinking || "" }); }
          else if (p.type === "image") {
            const parsed = parseHistoryImagePart(p);
            if (parsed) {
              images.push({ mediaType: parsed.mediaType, data: parsed.data });
            }
          }
          else if (p.type === "toolCall") {
            const toolCallId = p.id || `tc-${m.id}`;
            const saved = toolResults.get(toolCallId);
            const tc: ToolCallRecord = {
              toolCallId,
              toolName: p.name || "",
              input: p.arguments || {},
              status: saved ? (saved.isError ? "error" : "done") : "running",
              output: saved ? formatToolContent(saved.content) : undefined,
              isError: saved?.isError,
            };
            toolCalls.push(tc);
            blocks.push({ type: "tool", tool: tc });
          } else if (p.type === "toolResult") {
            const mt = toolCalls.find((t) => t.toolCallId === p.toolCallId);
            if (mt) {
              mt.output = formatToolContent(p.content);
              mt.isError = p.isError;
              mt.status = p.isError ? "error" : "done";
              const block = blocks.find(
                (b) => b.type === "tool" && b.tool.toolCallId === p.toolCallId
              );
              if (block?.type === "tool") {
                block.tool.output = mt.output;
                block.tool.isError = mt.isError;
                block.tool.status = mt.status;
              }
            }
          }
        }
      } else if (typeof m.content === "string") {
        content = m.content;
        rawTextForTags = m.content;
        blocks.push({ type: "text", text: content });
      }

      if (role === "user") {
        content = stripFileAttachmentTags(content);
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          if (block.type === "text") {
            const stripped = stripFileAttachmentTags(block.text);
            if (stripped) blocks[i] = { type: "text", text: stripped };
            else blocks.splice(i--, 1);
          }
        }
        if (images.length > 0) {
          const name = fileNameFromAttachmentTags(rawTextForTags);
          if (name) {
            for (const img of images) img.name = name;
          }
        }
      }

      const newMsg: ChatMessage = {
        id: m.id || `h-${Date.now()}`, role, content,
        timestamp: m.timestamp || Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        blocks: blocks.length > 0 ? blocks : undefined,
        images: images.length > 0 ? images : undefined,
        isStreaming: false,
      };

      // The agent SDK persists each LLM turn as its own assistant message
      // (turn 1: explore, turn 2: explore more, turn 3: final answer), but
      // it's one continuous reply to the user. Merge consecutive assistant
      // turns into a single message so history replays exactly like the
      // live stream did — same blocks, same order, same grouping/collapsing
      // — instead of fragmenting into one bubble per turn.
      const prev = converted.at(-1);
      if (prev && prev.role === "assistant" && role === "assistant") {
        prev.content += newMsg.content;
        prev.blocks = [...(prev.blocks ?? []), ...(newMsg.blocks ?? [])];
        if (newMsg.toolCalls?.length) prev.toolCalls = [...(prev.toolCalls ?? []), ...newMsg.toolCalls];
      } else {
        converted.push(newMsg);
      }
    }
    set({
      messages: converted,
      isStreaming: false,
      currentAssistantId: null,
      queuedSteering: [],
      queuedFollowUp: [],
    });
    if (options?.agentRunning) {
      get().resumeAgentRun();
    }
  },
}));
