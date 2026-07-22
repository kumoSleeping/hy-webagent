import type { WebSocket } from "ws";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PISessionManager } from "../pi/session-manager.js";
import type { TokenTracker } from "../pi/token-tracker.js";
import type { AuthSystem } from "../auth.js";
import { sanitizeInput } from "../security.js";
import { createLogger } from "../logger.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";
import { executeSlashCommand } from "../slash/router.js";
import type { SlashExecutePayload } from "../slash/types.js";
import type { UsageRecorder } from "../usage/recorder.js";
import { applyTurnUsage, budgetExceededMessage, isBudgetExceeded } from "../usage/turn-usage.js";
import { applySidecarToolUsage, isSidecarToolName } from "../usage/sidecar-usage.js";
import { budgetSnapshot } from "../auth.js";
import { toolResultToText } from "./tool-result-text.js";
import { summarizeProviderError } from "../lib/provider-error.js";
import { findSessionFilePath } from "../pi/session-files.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { BotRepository } from "../bot/repository.js";
import { parseServerToolActivity } from "../pi/server-tool-history.js";

const log = createLogger("ws:chat");

interface WSMessage {
  type: string;
  payload: unknown;
}

/**
 * Search all user workspace dirs for a session file and extract message history.
 * Used for guest/view-only connections when the session isn't in memory.
 */
async function findSessionHistoryOnDisk(piSessionId: string): Promise<{
  messages: any[];
  serverToolActivities: ReturnType<typeof parseServerToolActivity>[];
} | null> {
  try {
    const root = config.workspaceRoot;
    let userDirs: string[] = [];
    try { userDirs = await readdir(root); } catch { return null; }
    for (const name of userDirs) {
      try {
        const entryPath = join(root, name);
        const s = await stat(entryPath);
        if (!s.isDirectory()) continue;
      } catch { continue; }
      const sessionsDir = join(root, name, ".pi", "sessions");
      try {
        const filePath = await findSessionFilePath(sessionsDir, piSessionId);
        if (filePath) {
          const content = await readFile(filePath, "utf-8");
          const lines = content.trim().split("\n");
          const messages: any[] = [];
          const serverToolActivities: NonNullable<ReturnType<typeof parseServerToolActivity>>[] = [];
          for (let i = 1; i < lines.length; i++) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.type === "message" && entry.message) {
                messages.push(entry.message);
              } else if (entry.type === "custom" && entry.customType === "pi-web-server-tool:v1") {
                const activity = parseServerToolActivity(entry.data);
                if (activity) serverToolActivities.push(activity);
              }
            } catch {}
          }
          return { messages, serverToolActivities };
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

const HEARTBEAT_INTERVAL_MS = 30_000;  // Send ping every 30s
const HEARTBEAT_TIMEOUT_MS = 10_000;    // Client has 10s to respond with pong

export function handleChatWs(
  ws: WebSocket,
  sessionManager: PISessionManager,
  tokenTracker: TokenTracker,
  usageRecorder: UsageRecorder,
  authSystem: AuthSystem,
  isolator: WorkspaceIsolator,
  userId: string,
  piSessionId?: string,
  isViewOnly: boolean = false,
  botRepository?: BotRepository,
) {
  let activeAssistantMessageId: string | undefined;
  let syntheticAssistantSequence = 0;
  const toolOwnerMessageIds = new Map<string, string>();

  function assistantMessageId(message: any): string {
    return String(message?.id || activeAssistantMessageId || `live-assistant-${++syntheticAssistantSequence}`);
  }

  function send(msg: WSMessage) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sendTokenUpdate(
    snapshot: {
      input: number;
      output: number;
      costUsd: number;
    },
    user: ReturnType<AuthSystem["getUser"]>,
    extra?: Record<string, unknown>
  ) {
    send({
      type: "token:update",
      payload: {
        inputTokens: snapshot.input,
        outputTokens: snapshot.output,
        totalUsed: tokenTracker.getTotalTokens(userId),
        ...(user ? budgetSnapshot(user) : { budgetUsd: null, budgetUsedUsd: 0, budgetRemainingUsd: null, budgetUnlimited: true }),
        turnCostUsd: snapshot.costUsd,
        ...extra,
      },
    });
  }

  function onPiEvent(_uid: string, event: AgentSessionEvent) {
    switch (event.type) {
      case "message_start": {
        const evt: any = event;
        if (evt.message?.role === "assistant") {
          activeAssistantMessageId = assistantMessageId(evt.message);
          send({ type: "chat:assistant_start", payload: { messageId: activeAssistantMessageId } });
        }
        break;
      }
      case "message_update": {
        const ame: any = event.assistantMessageEvent;
        const messageId = assistantMessageId((event as any).message);
        activeAssistantMessageId = messageId;
        if (ame.type === "text_delta" && ame.delta) {
          send({ type: "chat:text_delta", payload: { messageId, delta: ame.delta } });
        }
        if (ame.type === "thinking_delta" && ame.delta) {
          send({ type: "chat:thinking_delta", payload: { messageId, delta: ame.delta } });
        }
        break;
      }
      case "tool_execution_start": {
        const evt: any = event;
        const ownerMessageId = toolOwnerMessageIds.get(String(evt.toolCallId)) || activeAssistantMessageId;
        send({
          type: "chat:tool_start",
          payload: {
            messageId: ownerMessageId,
            toolCallId: evt.toolCallId,
            toolName: evt.toolName,
            input: evt.args || {},
          },
        });
        sendFooterSnapshot();
        break;
      }
      case "tool_execution_update": {
        const evt: any = event;
        send({
          type: "chat:tool_update",
          payload: {
            messageId: toolOwnerMessageIds.get(String(evt.toolCallId)),
            toolCallId: evt.toolCallId,
            output: toolResultToText(evt.partialResult),
          },
        });
        break;
      }
      case "tool_execution_end": {
        const evt: any = event;
        send({
          type: "chat:tool_end",
          payload: {
            messageId: toolOwnerMessageIds.get(String(evt.toolCallId)),
            toolCallId: evt.toolCallId,
            isError: evt.isError,
            details: evt.result,
            output: toolResultToText(evt.result),
          },
        });

        if (isSidecarToolName(String(evt.toolName ?? ""))) {
          const sidecarResults = applySidecarToolUsage({
            userId,
            toolName: String(evt.toolName),
            details: evt.result,
            authSystem,
            tokenTracker,
            usageRecorder,
          });
          if (sidecarResults.length > 0) {
            const last = sidecarResults[sidecarResults.length - 1]!;
            log.info(
              `subagent usage entries=${sidecarResults.length} cost=$${sidecarResults.reduce((s, r) => s + r.snapshot.costUsd, 0).toFixed(4)} tool=${evt.toolName}`,
              { userId }
            );
            sendTokenUpdate(last.snapshot, last.user, { source: "subagent" });

            // Accumulate sidecar tokens for session-level footer display
            const sid = getActiveSessionId();
            if (sid) {
              for (const r of sidecarResults) {
                sessionManager.addSidecarUsage(
                  sid,
                  r.snapshot.input,
                  r.snapshot.output,
                  r.snapshot.costUsd
                );
              }
            }
          }
        }

        sendFooterSnapshot();
        break;
      }
      case "message_end": {
        const evt: any = event;
        if (evt.message?.role === "user") {
          send({ type: "chat:user_message", payload: { message: evt.message, phase: "end" } });
        } else if (evt.message?.role === "assistant") {
          const messageId = assistantMessageId(evt.message);
          if (Array.isArray(evt.message.content)) {
            for (const part of evt.message.content) {
              if (part?.type === "toolCall" && part.id) {
                toolOwnerMessageIds.set(String(part.id), messageId);
              }
            }
          }
          send({ type: "chat:assistant_end", payload: { messageId } });
          if (evt.message.stopReason === "error" || evt.message.errorMessage) {
            const message = summarizeProviderError(evt.message.errorMessage || "Request failed");
            send({ type: "chat:error", payload: { message, messageId } });
          }
          if (activeAssistantMessageId === messageId) activeAssistantMessageId = undefined;
        }
        break;
      }
      case "agent_start":
        send({ type: "chat:agent_start", payload: {} });
        if (getActiveSessionId()) botRepository?.updateSessionStatus(getActiveSessionId()!, "running");
        startLiveUiPush();
        break;
      case "agent_end": {
        const endedSid = getActiveSessionId();
        if (endedSid) sessionManager.clearWorkingMessage(endedSid);
        send({ type: "chat:agent_end", payload: {} });
        send({ type: "working:update", payload: { message: null, visible: false } });
        if (endedSid) botRepository?.updateSessionStatus(endedSid, "idle");
        stopLiveUiPush();
        sendFooterSnapshot();
        sendWidgetSnapshot();
        break;
      }
      case "queue_update": {
        const evt: any = event;
        send({
          type: "chat:queue_update",
          payload: { steering: evt.steering ?? [], followUp: evt.followUp ?? [] },
        });
        break;
      }
      case "turn_end": {
        const evt: any = event;
        if (!evt.message?.usage) break;

        const result = applyTurnUsage({
          userId,
          message: evt.message,
          source: "chat",
          authSystem,
          tokenTracker,
          usageRecorder,
        });
        if (!result) break;

        const { snapshot, user } = result;
        log.info(
          `turn_end tokens in=${snapshot.input} out=${snapshot.output} cost=$${snapshot.costUsd.toFixed(4)} model=${snapshot.provider}/${snapshot.model}`,
          { userId }
        );
        sendTokenUpdate(snapshot, user, { source: "chat" });
        sendFooterSnapshot();
        break;
      }
    }
  }

  let activePiSessionId = piSessionId;
  let rehydratePromise: Promise<void> | null = null;

  function getActiveSession(): ReturnType<PISessionManager["getSessionForUser"]> {
    if (activePiSessionId) {
      // When the client names a session, never fall back to another user session —
      // that would replay the wrong history on refresh while rehydration is pending.
      return sessionManager.getSession(activePiSessionId);
    }
    return sessionManager.getSessionForUser(userId);
  }

  function getActiveSessionId(): string | undefined {
    return getActiveSession()?.sessionId;
  }

  async function ensureSessionReady(): Promise<NonNullable<ReturnType<typeof getActiveSession>> | undefined> {
    if (rehydratePromise) {
      try {
        await rehydratePromise;
      } catch {
        return undefined;
      }
    }
    return getActiveSession();
  }

  const existing = getActiveSession();
  let eventUnsubscribe: (() => void) | undefined;

  /**
   * Route Pi agent events to this websocket. Uses UserPISession.onEvent so fork /
   * runtime rebind keeps streaming working. Re-subscribes on connect because
   * older builds closed over the HTTP noop handler at register time.
   */
  function subscribeToSession(session: NonNullable<ReturnType<typeof getActiveSession>>) {
    eventUnsubscribe?.();
    const prevOnEvent = session.onEvent;
    session.onEvent = onPiEvent;
    session.unsubscribe();
    session.unsubscribe = session.session.subscribe((evt) => session.onEvent(userId, evt));
    eventUnsubscribe = () => {
      session.unsubscribe();
      session.onEvent = prevOnEvent;
      session.unsubscribe = session.session.subscribe((evt) => session.onEvent(userId, evt));
    };
  }

  function sendStatusSnapshot() {
    const sid = getActiveSessionId();
    if (!sid) return;
    const items = sessionManager.getExtensionStatusSnapshot(sid);
    send({ type: "status:snapshot", payload: { items } });
  }

  function sendFooterSnapshot() {
    const sid = getActiveSessionId();
    if (!sid) return;
    send({ type: "footer:update", payload: sessionManager.getFooterSnapshot(sid) });
  }

  function sendWidgetSnapshot() {
    const sid = getActiveSessionId();
    if (!sid) return;
    send({ type: "widget:update", payload: sessionManager.getWidgetSnapshot(sid) });
  }

  /** Mirror native pi: keep footer + below-editor widgets live while the agent runs. */
  const LIVE_UI_MS = 250;
  let liveUiTimer: ReturnType<typeof setInterval> | null = null;

  function startLiveUiPush() {
    stopLiveUiPush();
    const push = () => {
      sendFooterSnapshot();
      sendWidgetSnapshot();
    };
    push();
    liveUiTimer = setInterval(push, LIVE_UI_MS);
  }

  function stopLiveUiPush() {
    if (liveUiTimer) {
      clearInterval(liveUiTimer);
      liveUiTimer = null;
    }
  }

  function sendQueueSnapshot() {
    const sid = getActiveSessionId();
    if (!sid) return;
    send({ type: "chat:queue_update", payload: sessionManager.getQueuedMessages(sid) });
  }

  function sendUiSnapshot() {
    sendStatusSnapshot();
    sendFooterSnapshot();
    sendWidgetSnapshot();
    sendQueueSnapshot();
    const sid = getActiveSessionId();
    if (!sid) return;
    send({
      type: "ui:snapshot",
      payload: {
        footer: sessionManager.getFooterSnapshot(sid),
        widgets: sessionManager.getWidgetSnapshot(sid),
        plugins: sessionManager.getExtensionStatusSnapshot(sid),
        workingMessage: sessionManager.getWorkingMessage(sid),
        agentRunning: sessionManager.isAgentRunning(sid),
      },
    });
  }

  function sendStatusUpdate(key: string, text: string | null) {
    send({ type: "status:update", payload: { key, text } });
  }

  function attachStatusListener(sessionId: string) {
    sessionManager.setStatusListener(sessionId, (_uid, update) => {
      if (update.key.startsWith("__")) return;
      sendStatusUpdate(update.key, update.text);
    });
    sessionManager.setWorkingListener(sessionId, (_uid, update) => {
      send({ type: "working:update", payload: update });
    });
    sessionManager.setWidgetListener(sessionId, (_uid, snapshot) => {
      send({ type: "widget:update", payload: snapshot });
    });
    sessionManager.setFooterListener(sessionId, (_uid, snapshot) => {
      send({ type: "footer:update", payload: snapshot });
    });
    sessionManager.setExtensionUiListener(sessionId, (_uid, request) => {
      send({ type: "extension_ui:request", payload: request });
    });
  }

  function detachStatusListener(sessionId: string) {
    sessionManager.setStatusListener(sessionId, undefined);
    sessionManager.setWorkingListener(sessionId, undefined);
    sessionManager.setWidgetListener(sessionId, undefined);
    sessionManager.setFooterListener(sessionId, undefined);
    sessionManager.setExtensionUiListener(sessionId, undefined);
  }

  function switchActiveSession(newSessionId: string) {
    if (newSessionId === activePiSessionId) return;
    if (activePiSessionId) {
      sessionManager.markDisconnected(activePiSessionId);
      detachStatusListener(activePiSessionId);
    }
    activePiSessionId = newSessionId;
    const session = sessionManager.getSession(newSessionId);
    if (session) {
      sessionManager.markConnected(newSessionId);
      subscribeToSession(session);
      attachStatusListener(newSessionId);
      sendUiSnapshot();
      sendHistorySnapshot();
    }
  }

  function sendHistorySnapshot() {
    const sid = getActiveSessionId();
    if (!sid) return;
    try {
      const messages = sessionManager.getMessages(sid);
      const serverToolActivities = sessionManager.getServerToolActivities(sid);
      const agentRunning = sessionManager.isAgentRunning(sid);
      send({ type: "chat:history", payload: { messages, serverToolActivities, agentRunning } });
      if (agentRunning) startLiveUiPush();
    } catch (err) {
      log.warn(`failed to send history: ${(err as Error).message}`);
    }
  }

  if (existing) {
    if (isViewOnly) {
      // Guest/view-only: send snapshot but DO NOT steal event subscription
      // (the owner WS still needs to receive agent events)
      sendHistorySnapshot();
      sendUiSnapshot();
      // Independently subscribe to live agent events for streaming preview
      let guestAssistantMessageId: string | undefined;
      let guestSyntheticSequence = 0;
      const guestToolOwners = new Map<string, string>();
      const guestMessageId = (message: any) => String(
        message?.id || guestAssistantMessageId || `guest-live-assistant-${++guestSyntheticSequence}`
      );
      const guestUnsub = existing.session.subscribe((evt) => {
        if (ws.readyState !== ws.OPEN) {
          guestUnsub();
          return;
        }
        try {
          switch (evt.type) {
            case "message_start": {
              const message: any = (evt as any).message;
              if (message?.role === "assistant") {
                guestAssistantMessageId = guestMessageId(message);
                send({ type: "chat:assistant_start", payload: { messageId: guestAssistantMessageId } });
              }
              break;
            }
            case "message_update": {
              const ame: any = evt.assistantMessageEvent;
              const messageId = guestMessageId((evt as any).message);
              guestAssistantMessageId = messageId;
              if (ame?.type === "text_delta" && ame.delta) {
                send({ type: "chat:text_delta", payload: { messageId, delta: ame.delta } });
              }
              if (ame?.type === "thinking_delta" && ame.delta) {
                send({ type: "chat:thinking_delta", payload: { messageId, delta: ame.delta } });
              }
              break;
            }
            case "message_end": {
              const message: any = (evt as any).message;
              if (message?.role === "assistant") {
                const messageId = guestMessageId(message);
                if (Array.isArray(message.content)) {
                  for (const part of message.content) {
                    if (part?.type === "toolCall" && part.id) guestToolOwners.set(String(part.id), messageId);
                  }
                }
                send({ type: "chat:assistant_end", payload: { messageId } });
                if (message.stopReason === "error" || message.errorMessage) {
                  const errText = summarizeProviderError(message.errorMessage || "Request failed");
                  send({ type: "chat:error", payload: { message: errText, messageId } });
                }
                if (guestAssistantMessageId === messageId) guestAssistantMessageId = undefined;
              } else if (message?.role === "user") {
                send({ type: "chat:user_message", payload: { message, phase: "end" } });
              }
              break;
            }
            case "tool_execution_start": {
              const event: any = evt;
              send({ type: "chat:tool_start", payload: {
                messageId: guestToolOwners.get(String(event.toolCallId)) || guestAssistantMessageId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: event.args || {},
              } });
              break;
            }
            case "tool_execution_update": {
              const event: any = evt;
              send({ type: "chat:tool_update", payload: {
                messageId: guestToolOwners.get(String(event.toolCallId)),
                toolCallId: event.toolCallId,
                output: toolResultToText(event.partialResult),
              } });
              break;
            }
            case "tool_execution_end": {
              const event: any = evt;
              send({ type: "chat:tool_end", payload: {
                messageId: guestToolOwners.get(String(event.toolCallId)),
                toolCallId: event.toolCallId,
                isError: event.isError,
                details: event.result,
                output: toolResultToText(event.result),
              } });
              break;
            }
            case "agent_start":
              send({ type: "chat:agent_start", payload: {} });
              break;
            case "agent_end":
              send({ type: "working:update", payload: { message: null, visible: false } });
              send({ type: "chat:agent_end", payload: {} });
              sendHistorySnapshot();
              break;
          }
        } catch {}
      });
      ws.on("close", () => guestUnsub());
    } else {
      sessionManager.markConnected(existing.sessionId);
      subscribeToSession(existing);
      attachStatusListener(existing.sessionId);
    }
    // ui:request_snapshot (sent by client on ws.onopen) triggers the full
    // snapshot+history delivery — avoid a duplicate round trip here.
  } else if (piSessionId) {
    // Server restarted or session evicted — rehydrate from client's piSessionId.
    rehydratePromise = (async () => {
      try {
        // Guest/view-only mode: search disk for session file across all workspaces
        if (isViewOnly) {
          const history = await findSessionHistoryOnDisk(piSessionId);
          if (history) {
            send({ type: "chat:history", payload: { ...history, agentRunning: false } });
            log.info("guest history served from disk", { piSessionId, count: history.messages.length });
            return;
          }
          send({ type: "chat:error", payload: { message: "Session not found or expired. Start a new chat." } });
          log.warn(`guest session not found on disk`, { piSessionId });
          // Close after a tick so the error message reaches the client
          setTimeout(() => { try { ws.close(); } catch {} }, 100);
          return;
        }
        const workspacePath = isolator.getUserWorkspace(userId);
        const ps = await sessionManager.createSession(userId, workspacePath, onPiEvent, piSessionId);
        activePiSessionId = ps.sessionId;
        sessionManager.markConnected(ps.sessionId);
        subscribeToSession(ps);
        attachStatusListener(ps.sessionId);
        log.info("session rehydrated", { userId, piSessionId });
      } catch (err) {
        log.error(`session rehydrate failed: ${(err as Error).message}`, { userId, piSessionId });
        send({ type: "chat:error", payload: { message: `Session unavailable: ${(err as Error).message}. Start a new chat.` } });
        setTimeout(() => { try { ws.close(); } catch {} }, 100);
      }
    })();
    void rehydratePromise.finally(() => {
      rehydratePromise = null;
    });
  }

  log.info("ws connected", { userId, piSessionId: activePiSessionId ?? null, viewOnly: isViewOnly });

  if (isViewOnly) {
    send({ type: "chat:notice", payload: { message: "Connected in view-only mode" } });
  }

  ws.on("message", async (raw) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // 只读模式：禁止任何写入操作
    if (isViewOnly) {
      const writableTypes = new Set([
        "chat:prompt", "chat:steer", "chat:followup", "chat:abort",
        "chat:dequeue", "slash:execute", "extension_ui:response",
      ]);
      if (writableTypes.has(msg.type)) {
        send({ type: "chat:error", payload: { message: "View-only mode: cannot send messages" } });
        return;
      }
    }

    try {
      switch (msg.type) {
        case "ui:request_snapshot": {
          sendUiSnapshot();
          sendHistorySnapshot();
          break;
        }
        case "ui:set_layout": {
          const { widgetRenderWidth } = (msg.payload ?? {}) as { widgetRenderWidth?: number };
          const sid = getActiveSessionId();
          if (sid && typeof widgetRenderWidth === "number" && Number.isFinite(widgetRenderWidth)) {
            sessionManager.setWidgetRenderWidth(sid, widgetRenderWidth);
            sendWidgetSnapshot();
          }
          break;
        }
        case "extension_ui:response": {
          const response = msg.payload as { id?: string; value?: string; confirmed?: boolean; cancelled?: boolean };
          const sid = getActiveSessionId();
          if (!sid || !response?.id) break;
          sessionManager.handleExtensionUiResponse(sid, {
            id: response.id,
            value: response.value,
            confirmed: response.confirmed,
            cancelled: response.cancelled,
          });
          break;
        }
        case "chat:prompt": {
          const { text, images } = msg.payload as any;

          // Security: sanitize input
          const result = sanitizeInput(String(text || ""));
          if (result.blocked) {
            log.warn(`prompt blocked: ${result.reason}`, { userId });
            send({ type: "chat:error", payload: { message: result.reason || "Input blocked by security policy" } });
            return;
          }
          if (result.injectionSuspected) {
            log.warn(`prompt injection suspected (not blocked): ${result.injectionReason}`, { userId });
          }

          const user = authSystem.getUser(userId);
          if (user && isBudgetExceeded(user)) {
            log.warn(`budget exceeded`, { userId });
            send({ type: "chat:error", payload: { message: budgetExceededMessage(user) } });
            return;
          }
          log.info(`prompt: ${result.clean.slice(0, 100)}`, { userId });
          const promptSession = await ensureSessionReady();
          if (!promptSession) {
            send({
              type: "chat:error",
              payload: {
                message: rehydratePromise
                  ? "Session is still loading. Wait a moment and try again."
                  : "No active session. Create a new chat first.",
              },
            });
            return;
          }

          await sessionManager.sendPrompt(promptSession.sessionId, result.clean, images);
          break;
        }
        case "chat:steer": {
          const { text } = msg.payload as any;
          const steerSessionId = getActiveSessionId();
          if (!steerSessionId) return;
          await sessionManager.sendSteer(steerSessionId, text);
          break;
        }
        case "chat:followup": {
          const { text } = msg.payload as any;
          const followUpSessionId = getActiveSessionId();
          if (!followUpSessionId) return;
          await sessionManager.sendFollowUp(followUpSessionId, text);
          break;
        }
        case "chat:abort": {
          const abortSessionId = getActiveSessionId();
          if (abortSessionId) await sessionManager.abort(abortSessionId);
          break;
        }
        case "chat:dequeue": {
          const dequeueSessionId = getActiveSessionId();
          if (!dequeueSessionId) return;
          // clearQueue() itself emits queue_update through the normal
          // subscription (handled by the "queue_update" case above), so we
          // only need to relay the cleared texts here.
          const cleared = sessionManager.clearQueue(dequeueSessionId);
          send({ type: "chat:dequeued", payload: cleared });
          break;
        }
        case "slash:execute": {
          const { command, args } = msg.payload as SlashExecutePayload;
          if (!command) {
            send({ type: "slash:error", payload: { command: command || "", message: "Missing command" } });
            return;
          }
          const slashSessionId = getActiveSessionId();
          if (!slashSessionId) {
            send({ type: "slash:error", payload: { command, message: "No active session" } });
            return;
          }
          log.info(`slash execute: ${command}`, { userId });
          try {
            const result = await executeSlashCommand(
              command,
              args,
              slashSessionId,
              sessionManager,
              userId,
              authSystem
            );
            send({ type: "slash:result", payload: result });
            sendFooterSnapshot();
            sendWidgetSnapshot();
            const newSessionId = (result as any)?.data?.sessionId as string | undefined;
            if (newSessionId) {
              switchActiveSession(newSessionId);
            } else if (command === "session.navigateTree" && (result as any)?.ok) {
              sendHistorySnapshot();
            }
          } catch (err) {
            log.error(`slash error: ${(err as Error).message}`, { userId });
            send({ type: "slash:error", payload: { command, message: (err as Error).message } });
          }
          break;
        }
      }
    } catch (err) {
      log.error(`ws error: ${(err as Error).message}`, { userId });
      send({ type: "chat:error", payload: { message: (err as Error).message } });
    }
  });

  // --- Heartbeat: detect half-open connections (e.g. tab inactive, network drop) ---
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimeout: ReturnType<typeof setTimeout> | undefined;
  let missedPongs = 0;

  function resetHeartbeat() {
    if (pongTimeout !== undefined) clearTimeout(pongTimeout);
    missedPongs = 0;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      try { ws.ping(); } catch { return; }
      pongTimeout = setTimeout(() => {
        missedPongs += 1;
        log.warn(`ws heartbeat missed pong #${missedPongs}`, { userId });
        if (missedPongs >= 2) {
          log.warn(`ws heartbeat failed — terminating connection`, { userId });
          stopHeartbeat();
          try { ws.terminate(); } catch { /* ignore */ }
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    if (pongTimeout !== undefined) {
      clearTimeout(pongTimeout);
      pongTimeout = undefined;
    }
  }

  ws.on("pong", () => {
    resetHeartbeat();
  });

  startHeartbeat();

  ws.on("close", () => {
    stopHeartbeat();
    stopLiveUiPush();
    eventUnsubscribe?.();
    const sid = getActiveSessionId();
    if (sid) {
      sessionManager.markDisconnected(sid);
      detachStatusListener(sid);
    }
    log.info(`ws disconnected`, { userId });
  });
}
