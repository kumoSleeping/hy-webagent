import {
  createAgentSession,
  SessionManager,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { PISessionManager } from "./session-manager.js";
import { createPlatformResourceLoader } from "./platform-system.js";

/** Side-question framing — kept in the user turn so system prompt matches the main session. */
const BTW_USER_PREFIX =
  "[By the way — quick side question while the main session continues. Answer concisely; use tools if helpful. Do not modify files unless this side question asks you to.]\n\n";

export interface BtwAskEmit {
  (type: string, payload?: Record<string, unknown>): void;
}

function cloneMessages<T>(messages: T[]): T[] {
  return structuredClone(messages);
}

/** Reuse main session id so provider-side prefix/session affinity matches the primary agent. */
function alignSessionManagerId(sessionManager: SessionManager, mainSessionId: string): void {
  (sessionManager as unknown as { sessionId: string }).sessionId = mainSessionId;
  const header = sessionManager.getHeader();
  if (header && header.type === "session") {
    header.id = mainSessionId;
  }
}

/** Route Pi agent events from a btw ephemeral session into btw:* websocket messages. */
export function emitBtwAgentEvent(event: AgentSessionEvent, emit: BtwAskEmit): void {
  switch (event.type) {
    case "message_update": {
      const ame = event.assistantMessageEvent as { type?: string; delta?: string };
      if (ame.type === "text_delta" && ame.delta) {
        emit("btw:text_delta", { delta: ame.delta });
      } else if (ame.type === "thinking_delta" && ame.delta) {
        emit("btw:thinking_delta", { delta: ame.delta });
      }
      break;
    }
    case "agent_start":
      emit("btw:agent_start", {});
      break;
    case "agent_end":
      emit("btw:agent_end", {});
      break;
    default:
      break;
  }
}

export interface BtwAskHooks {
  onTurnEnd?: (message: {
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: { total?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    };
  }) => void;
}

/**
 * Side question via ephemeral AgentSession — message prefix cloned from the main
 * session's buildSessionContext() so provider prompt cache can align.
 */
export async function runBtwAsk(
  sessionManager: PISessionManager,
  mainSessionId: string,
  userId: string,
  question: string,
  emit: BtwAskEmit,
  hooks?: BtwAskHooks
): Promise<void> {
  const trimmed = question.trim();
  let btwSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;

  try {
    if (!trimmed) {
      throw new Error("Question is required");
    }

    const ps =
      sessionManager.getSession(mainSessionId) ?? sessionManager.getSessionForUser(userId);
    if (!ps || ps.userId !== userId) {
      throw new Error("No active session");
    }

    const userMessages = ps.session.getUserMessagesForForking();
    const lastEntry = userMessages[userMessages.length - 1];
    if (!lastEntry?.entryId) {
      throw new Error("Start a conversation before using /btw");
    }

    const model = ps.session.model;
    if (!model) {
      throw new Error("No model selected");
    }

    const auth = await ps.session.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error);
    }
    if (!auth.apiKey) {
      throw new Error("Model has no API key");
    }

    const alignedMessages = cloneMessages(ps.session.messages);
    const mainSystemPrompt = ps.session.systemPrompt;
    const activeTools = ps.session.getActiveToolNames();

    const inMemoryManager = SessionManager.inMemory(ps.agentCwd);
    alignSessionManagerId(inMemoryManager, ps.session.sessionId);

    const resourceLoader = await createPlatformResourceLoader(ps.agentCwd, ps.agentDir, {
      includeAdminSkills: sessionManager.shouldIncludeAdminSkills(userId),
      workspacePath: ps.workspacePath,
      enableSandbox: !sessionManager.shouldIncludeAdminSkills(userId),
    });
    const { session } = await createAgentSession({
      cwd: ps.agentCwd,
      agentDir: ps.agentDir,
      sessionManager: inMemoryManager,
      resourceLoader,
      model,
      thinkingLevel: ps.session.thinkingLevel,
      modelRegistry: ps.session.modelRegistry,
      tools: activeTools,
    });
    btwSession = session;

    btwSession.state.messages = cloneMessages(alignedMessages);
    btwSession.state.systemPrompt = mainSystemPrompt;

    emit("btw:start", { question: trimmed });

    const unsubscribe = btwSession.subscribe((event) => {
      if (event.type === "turn_end" && event.message?.usage) {
        hooks?.onTurnEnd?.(event.message);
      }
      emitBtwAgentEvent(event, emit);
    });

    try {
      await btwSession.prompt(BTW_USER_PREFIX + trimmed);
    } finally {
      unsubscribe();
    }

    const finalAnswer = (btwSession.getLastAssistantText() ?? "").trim();
    if (!finalAnswer) {
      throw new Error(
        "Could not produce a plain-text answer. Rephrase the side question or wait for the main session to finish."
      );
    }

    emit("btw:end", { question: trimmed, answer: finalAnswer });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit("btw:error", { question: trimmed, message });
    throw err;
  } finally {
    btwSession?.dispose();
  }
}
