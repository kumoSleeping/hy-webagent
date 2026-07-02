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
import { emitBtwAgentEvent, runBtwAsk } from "../pi/btw-ask.js";
import { budgetSnapshot } from "../auth.js";
import { toolResultToText } from "./tool-result-text.js";

const log = createLogger("ws:chat");

interface WSMessage {
  type: string;
  payload: unknown;
}

export function handleChatWs(
  ws: WebSocket,
  sessionManager: PISessionManager,
  tokenTracker: TokenTracker,
  usageRecorder: UsageRecorder,
  authSystem: AuthSystem,
  isolator: WorkspaceIsolator,
  userId: string,
  piSessionId?: string
) {
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
    if (btwActive) {
      emitBtwAgentEvent(event, (type, payload) =>
        send({
          type,
          payload: btwQuestion ? { question: btwQuestion, ...payload } : payload,
        })
      );
      return;
    }
    switch (event.type) {
      case "message_update": {
        const ame: any = event.assistantMessageEvent;
        if (ame.type === "text_delta" && ame.delta) {
          send({ type: "chat:text_delta", payload: { delta: ame.delta } });
        }
        if (ame.type === "thinking_delta" && ame.delta) {
          send({ type: "chat:thinking_delta", payload: { delta: ame.delta } });
        }
        break;
      }
      case "tool_execution_start": {
        const evt: any = event;
        send({
          type: "chat:tool_start",
          payload: {
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
          }
        }

        sendFooterSnapshot();
        break;
      }
      case "agent_start":
        send({ type: "chat:agent_start", payload: {} });
        startLiveUiPush();
        break;
      case "agent_end":
        send({ type: "chat:agent_end", payload: {} });
        stopLiveUiPush();
        sendFooterSnapshot();
        sendWidgetSnapshot();
        break;
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
  let btwActive = false;
  let btwInFlight = false;
  /** Active /btw question — attached to streamed btw:* events from onPiEvent. */
  let btwQuestion: string | null = null;

  async function executeBtwAsk(question: string) {
    const trimmed = question.trim();
    const sid = getActiveSessionId();
    if (!sid) {
      send({ type: "btw:error", payload: { question: trimmed, message: "No active session" } });
      return;
    }
    if (!trimmed) {
      send({ type: "btw:error", payload: { message: "Question is required" } });
      return;
    }
    const user = authSystem.getUser(userId);
    if (user && isBudgetExceeded(user)) {
      send({ type: "btw:error", payload: { question: trimmed, message: budgetExceededMessage(user) } });
      return;
    }
    if (btwInFlight) {
      send({
        type: "btw:error",
        payload: { question: trimmed, message: "A /btw question is already running" },
      });
      return;
    }
    btwInFlight = true;
    btwActive = true;
    btwQuestion = trimmed;
    try {
      await runBtwAsk(
        sessionManager,
        sid,
        userId,
        trimmed,
        (type, payload) => send({ type, payload: { question: trimmed, ...payload } }),
        {
          onTurnEnd: (message) => {
            const result = applyTurnUsage({
              userId,
              message,
              source: "btw",
              authSystem,
              tokenTracker,
              usageRecorder,
            });
            if (!result) return;
            const { snapshot, user: updatedUser } = result;
            log.info(
              `btw turn_end cost=$${snapshot.costUsd.toFixed(4)} model=${snapshot.provider}/${snapshot.model}`,
              { userId }
            );
            sendTokenUpdate(snapshot, updatedUser, { source: "btw" });
          },
        }
      );
    } catch (err) {
      log.error(`btw error: ${(err as Error).message}`, { userId });
    } finally {
      btwActive = false;
      btwInFlight = false;
      btwQuestion = null;
      const restored = sessionManager.getSessionForUser(userId);
      if (restored) activePiSessionId = restored.sessionId;
      sendUiSnapshot();
      sendHistorySnapshot();
    }
  }

  function getActiveSession(): ReturnType<PISessionManager["getSessionForUser"]> {
    if (activePiSessionId) {
      // When the client names a session, never fall back to another user session —
      // that would replay the wrong history on refresh while rehydration is pending.
      return sessionManager.getSession(activePiSessionId);
    }
    return sessionManager.getSessionForUser(userId);
  }

  function getActiveSessionId(): string | undefined {
    return getActiveSession()?.sessionId || activePiSessionId;
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
        agentRunning: sessionManager.isAgentRunning(sid),
      },
    });
  }

  function sendStatusUpdate(key: string, text: string | null) {
    send({ type: "status:update", payload: { key, text } });
  }

  function attachStatusListener(sessionId: string) {
    sessionManager.setStatusListener(sessionId, (_uid, update) => {
      if (btwActive) return;
      if (update.key.startsWith("__")) return;
      sendStatusUpdate(update.key, update.text);
    });
    sessionManager.setWidgetListener(sessionId, (_uid, snapshot) => {
      if (btwActive) return;
      send({ type: "widget:update", payload: snapshot });
    });
    sessionManager.setFooterListener(sessionId, (_uid, snapshot) => {
      if (btwActive) return;
      send({ type: "footer:update", payload: snapshot });
    });
    sessionManager.setExtensionUiListener(sessionId, (_uid, request) => {
      send({ type: "extension_ui:request", payload: request });
    });
  }

  function detachStatusListener(sessionId: string) {
    sessionManager.setStatusListener(sessionId, undefined);
    sessionManager.setWidgetListener(sessionId, undefined);
    sessionManager.setFooterListener(sessionId, undefined);
    sessionManager.setExtensionUiListener(sessionId, undefined);
  }

  function switchActiveSession(newSessionId: string) {
    if (newSessionId === activePiSessionId) return;
    if (activePiSessionId) detachStatusListener(activePiSessionId);
    activePiSessionId = newSessionId;
    const session = sessionManager.getSession(newSessionId);
    if (session) {
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
      const agentRunning = sessionManager.isAgentRunning(sid);
      send({ type: "chat:history", payload: { messages, agentRunning } });
      if (agentRunning) startLiveUiPush();
    } catch (err) {
      log.warn(`failed to send history: ${(err as Error).message}`);
    }
  }

  if (existing) {
    subscribeToSession(existing);
    attachStatusListener(existing.sessionId);
    sendUiSnapshot();
    sendHistorySnapshot();
  } else if (piSessionId) {
    // Server restarted or session evicted — rehydrate from client's piSessionId.
    void (async () => {
      try {
        const workspacePath = isolator.getUserWorkspace(userId);
        const ps = await sessionManager.createSession(userId, workspacePath, onPiEvent, piSessionId);
        activePiSessionId = ps.sessionId;
        subscribeToSession(ps);
        attachStatusListener(ps.sessionId);
        sendUiSnapshot();
        sendHistorySnapshot();
      } catch (err) {
        log.error(`session rehydrate failed: ${(err as Error).message}`, { userId, piSessionId });
      }
    })();
  }

  ws.on("message", async (raw) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
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
          const promptSessionId = getActiveSessionId();
          if (!promptSessionId) {
            send({ type: "chat:error", payload: { message: "No active session. Create a new chat first." } });
            return;
          }

          const btwMatch = result.clean.trim().match(/^\/btw(?:\s+(.+))?$/i);
          if (btwMatch) {
            const q = btwMatch[1]?.trim();
            if (!q) {
              send({ type: "btw:error", payload: { message: "Usage: /btw <question>" } });
              return;
            }
            await executeBtwAsk(q);
            return;
          }

          await sessionManager.sendPrompt(promptSessionId, result.clean, images);
          break;
        }
        case "btw:ask": {
          const { question } = (msg.payload ?? {}) as { question?: string };
          await executeBtwAsk(String(question || ""));
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

  ws.on("close", () => {
    stopLiveUiPush();
    eventUnsubscribe?.();
    const sid = getActiveSessionId();
    if (sid) detachStatusListener(sid);
    log.info(`ws disconnected`, { userId });
  });
}
