import { create } from "zustand";
import type { ChatMessage, ChatImageAttachment, ContentBlock, ToolCallRecord } from "../types";
import { formatToolContent, isGarbageToolOutput } from "../lib/toolDisplay";
import { summarizeProviderError } from "../lib/providerError";
import {
  fileNameFromAttachmentTags,
  parseHistoryImagePart,
  stripFileAttachmentTags,
} from "../lib/prepareAttachments";
import { convertSdkUserMessage } from "../lib/convertUserMessage";
import { parseSkillInvocation } from "../lib/skillInvocation";
import { collapseSerializedPastes } from "../lib/compressedText";

let counter = 0;
function nextId() { return `msg-${++counter}-${Date.now()}`; }

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isBlankAssistantPayload(m: ChatMessage): boolean {
  if (m.error?.trim()) return false;
  if (m.images?.length) return false;
  if (m.content.trim()) return false;
  if (m.blocks?.length) return false;
  if (m.toolCalls?.length) return false;
  return true;
}

/** Orphan assistant bubble — created when agent_start raced ahead of tool/text events. */
function isEmptyAssistantMessage(m: ChatMessage): boolean {
  if (m.role !== "assistant" || m.isStreaming) return false;
  return isBlankAssistantPayload(m);
}

/** Empty streaming bubble from agent_start / ensureStreamingAssistant — before a real messageId arrives. */
function isEmptyStreamingPlaceholder(m: ChatMessage): boolean {
  return m.role === "assistant" && !!m.isStreaming && isBlankAssistantPayload(m);
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentAssistantId: string | null;
  /** Steering/follow-up text queued behind the current turn — the model
   * hasn't actually seen these yet, so they're kept out of `messages`
   * until the SDK reports they've actually been dequeued for delivery. */
  queuedSteering: string[];
  queuedFollowUp: string[];

  /** Insert a user message at the SDK-persisted position (splits a live assistant turn when needed). */
  commitUserMessage: (raw: any) => void;
  /** Show the user's turn immediately (with images) before the server echoes it. */
  appendOptimisticUserMessage: (content: string, images?: ChatImageAttachment[]) => void;
  startAssistantMessage: (serverId?: string) => string;
  appendTextDelta: (msgId: string, delta: string, contentIndex?: number) => void;
  appendThinkingDelta: (msgId: string, delta: string, contentIndex?: number) => void;
  addToolCall: (msgId: string, tool: ToolCallRecord) => void;
  updateToolCall: (msgId: string, toolCallId: string, output: string) => void;
  endToolCall: (
    msgId: string,
    toolCallId: string,
    isError: boolean,
    details?: unknown,
    outputFromEnd?: string,
    inputFromEnd?: Record<string, unknown>,
  ) => void;
  finalizeRunningToolCalls: (msgId: string) => void;
  finishAssistantMessage: (msgId: string) => void;
  /** Close one SDK assistant message without ending the surrounding agent run. */
  finishAssistantTurn: (
    msgId: string,
    stopReason?: string,
    textSignatures?: Record<string, string>,
  ) => void;
  /** Attach a provider/API failure to an assistant bubble so it is not dropped as empty. */
  setAssistantError: (msgId: string, error: string) => void;
  /** Close the surrounding agent run and clean up any empty event placeholders. */
  finishAgentRun: () => void;
  setStreaming: (v: boolean) => void;
  clearMessages: () => void;
  /** Drop transcript and hydration when switching Pi sessions. */
  resetForSessionChange: () => void;
  /** Pi session id whose transcript (+ deferred UI) is ready to display. */
  hydratedPiSessionId: string | null;
  completeHydration: (piSessionId: string) => void;
  loadHistory: (messages: any[], options?: {
    agentRunning?: boolean;
    serverToolActivities?: PersistedServerToolActivity[];
  }) => void;
  /** Re-attach streaming UI after reload/reconnect while the server agent still runs. */
  resumeAgentRun: () => void;
  /** Resolve (or create) the assistant bubble that should receive live deltas. */
  ensureStreamingAssistant: () => string;
  /** Reconciles the server's queue snapshot for composer badges only.
   * User messages enter the transcript via commitUserMessage on chat:user_message. */
  syncQueuedMessages: (steering: string[], followUp: string[]) => void;
  /** Optimistically clears the local queue view right when the user asks to
   * recall queued messages back into the composer — must run *before* the
   * server's own (now-empty) snapshot arrives, otherwise that snapshot would
   * read as "everything just got delivered" and wrongly post them as real
   * messages instead of just handing them back for editing. */
  clearQueuedMessagesLocally: () => void;
}

interface PersistedServerToolActivity {
  phase: "start" | "done";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  recordedAt: number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentAssistantId: null,
  queuedSteering: [],
  queuedFollowUp: [],
  hydratedPiSessionId: null,

  commitUserMessage: (raw) => {
    const msg = convertSdkUserMessage(raw, nextId);
    if (!msg) return;
    set((s) => {
      if (s.messages.some((m) => m.id === msg.id)) return s;

      // Prefer replacing an optimistic local bubble (same text / image count).
      const optimisticIdx = s.messages.findIndex(
        (m) =>
          m.id.startsWith("local-") &&
          m.role === "user" &&
          m.content === msg.content &&
          (m.images?.length ?? 0) === (msg.images?.length ?? 0)
      );
      if (optimisticIdx !== -1) {
        const messages = [...s.messages];
        messages[optimisticIdx] = msg;
        return { messages };
      }

      // Content-based fallback for reconnect races — but do not drop a
      // server image message just because an earlier empty-text user turn exists.
      const sameTextIdx = s.messages.findIndex(
        (m) =>
          m.role === msg.role &&
          m.content === msg.content &&
          (m.images?.length ?? 0) === (msg.images?.length ?? 0)
      );
      if (sameTextIdx !== -1) return s;

      const streamingIdx = s.messages.findIndex((m) => m.isStreaming);
      if (streamingIdx !== -1) {
        const streaming = s.messages[streamingIdx]!;
        const finalizedAssistant = { ...streaming, isStreaming: false };
        const messages = [...s.messages];
        messages[streamingIdx] = finalizedAssistant;
        messages.splice(streamingIdx + 1, 0, msg);
        return {
          messages,
          currentAssistantId: null,
        };
      }
      return { messages: [...s.messages, msg] };
    });
  },

  appendOptimisticUserMessage: (content, images) => {
    const msg: ChatMessage = {
      id: `local-${nextId()}`,
      role: "user",
      content: stripFileAttachmentTags(content),
      timestamp: Date.now(),
      images: images?.length ? images : undefined,
    };
    if (!msg.content.trim() && !msg.images?.length) return;
    set((s) => {
      if (
        s.messages.some(
          (m) =>
            m.role === "user" &&
            m.content === msg.content &&
            (m.images?.length ?? 0) === (msg.images?.length ?? 0)
        )
      ) {
        return s;
      }
      return { messages: [...s.messages, msg] };
    });
  },

  syncQueuedMessages: (steering, followUp) => {
    set((s) => {
      if (
        arraysEqual(s.queuedSteering, steering) &&
        arraysEqual(s.queuedFollowUp, followUp)
      ) {
        return s;
      }
      return { queuedSteering: steering, queuedFollowUp: followUp };
    });
  },

  clearQueuedMessagesLocally: () => set({ queuedSteering: [], queuedFollowUp: [] }),

  startAssistantMessage: (serverId) => {
    const s = get();
    if (serverId) {
      const existing = s.messages.find((m) => m.id === serverId);
      if (existing) {
        set((prev) => ({
          messages: prev.messages.map((m) => m.id === serverId ? { ...m, isStreaming: true } : m),
          currentAssistantId: serverId,
          isStreaming: true,
        }));
        return serverId;
      }
      // agent_start / ensureStreamingAssistant may have already created an empty
      // local streaming bubble. Promote that placeholder to the real messageId
      // instead of appending a second assistant — otherwise the UI shows two
      // Thinking blocks and the empty one spins forever.
      const placeholder = s.messages.find(isEmptyStreamingPlaceholder);
      if (placeholder) {
        set((prev) => ({
          messages: prev.messages.map((m) =>
            m.id === placeholder.id ? { ...m, id: serverId } : m
          ),
          currentAssistantId: serverId,
          isStreaming: true,
        }));
        return serverId;
      }
      const msg: ChatMessage = {
        id: serverId, role: "assistant", content: "", timestamp: Date.now(),
        toolCalls: [], blocks: [], isStreaming: true,
      };
      set((prev) => ({ messages: [...prev.messages, msg], isStreaming: true, currentAssistantId: serverId }));
      return serverId;
    }
    if (s.currentAssistantId) {
      const current = s.messages.find((m) => m.id === s.currentAssistantId);
      if (current?.isStreaming) return s.currentAssistantId;
    }
    const streaming = s.messages.find((m) => m.isStreaming);
    if (streaming) {
      set({ currentAssistantId: streaming.id, isStreaming: true });
      return streaming.id;
    }
    const id = nextId();
    const msg: ChatMessage = {
      id, role: "assistant", content: "", timestamp: Date.now(),
      toolCalls: [], blocks: [], isStreaming: true,
    };
    set((prev) => ({ messages: [...prev.messages, msg], isStreaming: true, currentAssistantId: id }));
    return id;
  },

  appendTextDelta: (msgId, delta, contentIndex) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const blocks = m.blocks ?? [];
        const target = contentIndex == null
          ? blocks.length - 1
          : blocks.findIndex((block) => block.contentIndex === contentIndex);
        const existing = target >= 0 ? blocks[target] : undefined;
        if (existing?.type === "text") {
          const nextBlocks = [...blocks];
          nextBlocks[target] = { ...existing, text: existing.text + delta };
          return { ...m, content: m.content + delta, blocks: nextBlocks };
        }
        const nextBlocks = [...blocks, {
          type: "text" as const,
          text: delta,
          ...(contentIndex == null ? {} : { contentIndex }),
        }]
          .sort((left, right) => (left.contentIndex ?? Number.MAX_SAFE_INTEGER) - (right.contentIndex ?? Number.MAX_SAFE_INTEGER));
        return { ...m, content: m.content + delta, blocks: nextBlocks };
      }),
    }));
  },

  // Thinking segments live inline in `blocks`, in true arrival order, so a
  // "thinking → tool → thinking → tool → text" turn renders (and later
  // regroups) in the order it actually happened instead of being hoisted
  // to the top of the message as one lump.
  appendThinkingDelta: (msgId, delta, contentIndex) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const blocks = m.blocks ?? [];
        const target = contentIndex == null
          ? blocks.length - 1
          : blocks.findIndex((block) => block.contentIndex === contentIndex);
        const existing = target >= 0 ? blocks[target] : undefined;
        if (existing?.type === "thinking") {
          const nextBlocks = [...blocks];
          nextBlocks[target] = { ...existing, text: existing.text + delta };
          return { ...m, blocks: nextBlocks };
        }
        const nextBlocks = [...blocks, {
          type: "thinking" as const,
          text: delta,
          ...(contentIndex == null ? {} : { contentIndex }),
        }]
          .sort((left, right) => (left.contentIndex ?? Number.MAX_SAFE_INTEGER) - (right.contentIndex ?? Number.MAX_SAFE_INTEGER));
        return { ...m, blocks: nextBlocks };
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
              ? { ...b, tool: { ...b.tool, output } }
              : b
          ),
        } : m
      ),
    }));
  },

  endToolCall: (msgId, toolCallId, isError, details, outputFromEnd, inputFromEnd) => {
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
        input: inputFromEnd && Object.keys(inputFromEnd).length > 0 ? inputFromEnd : tc.input,
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
              ? { ...b, tool: mergeTool(b.tool) }
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
                b.type === "tool" ? { ...b, tool: markDone(b.tool) } : b
              ),
            }
          : m
      ),
    }));
  },

  finishAssistantMessage: (msgId) => {
    set((s) => ({
      messages: s.messages
        .map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
        .filter((m) => !isEmptyAssistantMessage(m)),
      isStreaming: false,
      currentAssistantId: null,
    }));
  },

  finishAssistantTurn: (msgId, stopReason, textSignatures) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const blocks = m.blocks?.map((block) =>
          block.type === "text" && textSignatures?.[String(block.contentIndex)]
            ? { ...block, textSignature: textSignatures[String(block.contentIndex)] }
            : block
        );
        return { ...m, blocks, stopReason, isStreaming: false };
      }),
      currentAssistantId: s.currentAssistantId === msgId ? null : s.currentAssistantId,
      // The agent may now execute tools and start another assistant message.
      isStreaming: true,
    }));
  },

  setAssistantError: (msgId, error) => {
    const text = error.trim();
    if (!text) return;
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, error: text, isStreaming: false } : m
      ),
    }));
  },

  finishAgentRun: () => {
    const markDone = (tc: ToolCallRecord): ToolCallRecord =>
      tc.status === "running" ? { ...tc, status: "done" as const } : tc;
    set((s) => ({
      messages: s.messages
        .map((m) => ({
          ...m,
          isStreaming: false,
          toolCalls: m.toolCalls?.map(markDone),
          blocks: m.blocks?.map((b) => b.type === "tool" ? { ...b, tool: markDone(b.tool) } : b),
        }))
        .filter((m) => !isEmptyAssistantMessage(m)),
      isStreaming: false,
      currentAssistantId: null,
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
      // Before hydration is complete, avoid creating a synthetic assistant
      // bubble — chat:history will supply the real messages shortly.  Creating
      // an empty message now would attract live deltas that get wiped when
      // history arrives, potentially also leaking text into other UI surfaces.
      if (!s.hydratedPiSessionId) return { isStreaming: true };
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
      let skillInvocation: ChatMessage["skillInvocation"];
      let rawTextForTags = "";
      if (Array.isArray(m.content)) {
        for (let contentIndex = 0; contentIndex < m.content.length; contentIndex += 1) {
          const p = m.content[contentIndex];
          if (p.type === "text") {
            content += p.text;
            rawTextForTags += p.text;
            blocks.push({ type: "text", text: p.text, textSignature: p.textSignature, contentIndex });
          }
          else if (p.type === "thinking") { blocks.push({ type: "thinking", text: p.thinking || "", contentIndex }); }
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
            blocks.push({ type: "tool", tool: tc, contentIndex });
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
        const parsedSkill = parseSkillInvocation(content);
        if (parsedSkill) {
          skillInvocation = { name: parsedSkill.name };
          content = parsedSkill.userMessage ?? "";
          blocks.length = 0;
          if (content) blocks.push({ type: "text", text: content });
        }
        content = collapseSerializedPastes(content);
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
        skillInvocation,
        isStreaming: false,
        error:
          role === "assistant" && (m.stopReason === "error" || m.errorMessage)
            ? summarizeProviderError(m.errorMessage || "Request failed")
            : undefined,
        stopReason: typeof m.stopReason === "string" ? m.stopReason : undefined,
      };

      // Preserve the SDK message boundary. A single agent run often contains
      // several assistant messages separated by tool results. Merging those
      // records leaks process narration into the final answer and makes a
      // right-click export capture content from unrelated model turns.
      converted.push(newMsg);
    }
    const restoredTools = new Map<string, {
      first: PersistedServerToolActivity;
      done?: PersistedServerToolActivity;
    }>();
    for (const activity of options?.serverToolActivities ?? []) {
      const current = restoredTools.get(activity.toolCallId);
      if (!current) {
        restoredTools.set(activity.toolCallId, {
          first: activity,
          done: activity.phase === "done" ? activity : undefined,
        });
      } else if (activity.phase === "done") {
        current.done = activity;
      }
    }

    const syntheticTools: ChatMessage[] = [...restoredTools.values()].map(({ first, done }) => {
      const tool: ToolCallRecord = {
        toolCallId: first.toolCallId,
        toolName: first.toolName,
        input: done?.input ?? first.input,
        output: done?.output,
        status: done ? "done" : options?.agentRunning ? "running" : "done",
        isError: false,
      };
      return {
        id: `server-tool-${first.toolCallId}`,
        role: "assistant",
        content: "",
        timestamp: first.recordedAt,
        toolCalls: [tool],
        blocks: [{ type: "tool", tool }],
        isStreaming: false,
      };
    });

    const restoredMessages = [...converted, ...syntheticTools].sort(
      (left, right) => left.timestamp - right.timestamp
    );

    set({
      messages: restoredMessages,
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
