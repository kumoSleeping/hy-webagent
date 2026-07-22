import { useEffect, useRef, useCallback, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSlashStore } from "../stores/slashStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useComposerFocusStore } from "../stores/composerFocusStore";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useExtensionUiStore } from "../stores/extensionUiStore";
import { hasVisibleWidgets } from "../components/extension-ui/ExtensionWidgetBody";
import { applyStatusPayload } from "./useStatusBarSync";
import { useComposerLayoutSync } from "./useComposerLayoutSync";
import { copyTextToClipboard } from "../lib/copyToClipboard";
import type { ExtensionUIRequest } from "../types/extension-ui";
import { apiGet } from "../lib/api";
import type { SlashCommand } from "../stores/slashStore";

const HYDRATION_FALLBACK_MS = 10_000;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 8;

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ChatWebSocketApi {
  sendPrompt: (text: string, images?: { mediaType: string; data: string }[]) => boolean;
  sendSteer: (text: string) => boolean;
  sendFollowUp: (text: string) => boolean;
  sendAbort: () => boolean;
  sendDequeue: () => boolean;
  sendSlash: (command: string, args?: Record<string, unknown>) => boolean;
  sendExtensionUiResponse: (response: {
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
  connectionState: ConnectionState;
}

function dispatchWsMessage(
  msg: { type: string; payload: any },
  boundPiSessionId: string,
  finishHydration: () => void
) {
  if (useSessionStore.getState().activePiSessionId !== boundPiSessionId) return;

  const store = useChatStore.getState;

  switch (msg.type) {
    case "chat:history": {
      const agentRunning = Boolean(msg.payload?.agentRunning);
      const messages = msg.payload?.messages || [];
      const alreadyHydrated = store().hydratedPiSessionId === boundPiSessionId;
      if (alreadyHydrated) {
        // Fallback timer may have completed hydration before history arrived.
        // Still load the real messages when they come in.
        if (messages.length > 0) {
          store().loadHistory(messages, {
            agentRunning,
            serverToolActivities: msg.payload?.serverToolActivities,
          });
        } else if (agentRunning) {
          store().resumeAgentRun();
        }
      } else {
        store().loadHistory(messages, {
          agentRunning,
          serverToolActivities: msg.payload?.serverToolActivities,
        });
      }
      finishHydration();
      break;
    }
    case "chat:user_message": {
      const raw = msg.payload?.message;
      if (msg.payload?.phase === "end" && raw?.role === "user") {
        store().commitUserMessage(raw);
      }
      break;
    }
    case "chat:assistant_start": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      store().startAssistantMessage(messageId);
      break;
    }
    case "chat:text_delta": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = messageId ? store().startAssistantMessage(messageId) : store().ensureStreamingAssistant();
      store().appendTextDelta(aid, msg.payload.delta, msg.payload.contentIndex);
      break;
    }
    case "chat:thinking_delta": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = messageId ? store().startAssistantMessage(messageId) : store().ensureStreamingAssistant();
      store().appendThinkingDelta(aid, msg.payload.delta, msg.payload.contentIndex);
      break;
    }
    case "chat:tool_start": {
      const requestedId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = requestedId && store().messages.some((m) => m.id === requestedId)
        ? requestedId
        : store().ensureStreamingAssistant();
      store().addToolCall(aid, {
        toolCallId: msg.payload.toolCallId,
        toolName: msg.payload.toolName,
        input: msg.payload.input,
        status: "running",
      });
      break;
    }
    case "chat:tool_update": {
      const aid = store().messages.find((m) => m.toolCalls?.some((tool) => tool.toolCallId === msg.payload.toolCallId))?.id
        ?? store().currentAssistantId
        ?? store().ensureStreamingAssistant();
      store().updateToolCall(aid, msg.payload.toolCallId, msg.payload.output);
      break;
    }
    case "chat:tool_end": {
      const aid = store().messages.find((m) => m.toolCalls?.some((tool) => tool.toolCallId === msg.payload.toolCallId))?.id
        ?? store().currentAssistantId
        ?? store().ensureStreamingAssistant();
      store().endToolCall(
        aid,
        msg.payload.toolCallId,
        msg.payload.isError,
        msg.payload.details,
        msg.payload.output
      );
      break;
    }
    case "chat:assistant_end": {
      const messageId = typeof msg.payload?.messageId === "string"
        ? msg.payload.messageId
        : store().currentAssistantId;
      if (messageId) {
        store().finishAssistantTurn(
          messageId,
          typeof msg.payload?.stopReason === "string" ? msg.payload.stopReason : undefined,
          msg.payload?.textSignatures,
        );
      }
      break;
    }
    case "chat:agent_start":
      store().ensureStreamingAssistant();
      break;
    case "chat:agent_end": {
      store().finishAgentRun();
      useStatusBarStore.getState().setWorkingMessage(null);
      break;
    }
    case "working:update": {
      const visible = msg.payload?.visible !== false;
      const text = visible ? (msg.payload?.message ?? null) : null;
      useStatusBarStore.getState().setWorkingMessage(text);
      break;
    }
    case "chat:notice":
      if (msg.payload?.message) {
        useNotificationStore.getState().notify(msg.payload.message, "info");
      }
      break;
    case "chat:error": {
      console.error("Chat error:", msg.payload.message);
      const errorText = typeof msg.payload?.message === "string" && msg.payload.message.trim()
        ? msg.payload.message.trim()
        : "Chat error";
      const errorMessageId = typeof msg.payload?.messageId === "string"
        ? msg.payload.messageId
        : store().currentAssistantId;
      if (errorMessageId) store().setAssistantError(errorMessageId, errorText);
      store().setStreaming(false);
      useNotificationStore.getState().notify(errorText, "info");
      break;
    }
    case "chat:queue_update": {
      const steering: string[] = Array.isArray(msg.payload?.steering) ? msg.payload.steering : [];
      const followUp: string[] = Array.isArray(msg.payload?.followUp) ? msg.payload.followUp : [];
      store().syncQueuedMessages(steering, followUp);
      break;
    }
    case "token:update":
      useAuthStore.getState().updateBudgetFromToken(msg.payload ?? {});
      break;
    case "status:snapshot": {
      const items = msg.payload?.items;
      if (items && typeof items === "object") {
        useStatusBarStore.getState().applyPluginSnapshot(items as Record<string, string>);
      }
      break;
    }
    case "status:update":
      useStatusBarStore.getState().setPluginStatus(
        String(msg.payload?.key || ""),
        msg.payload?.text ?? null
      );
      break;
    case "footer:update":
      if (msg.payload) useStatusBarStore.getState().setFooter(msg.payload);
      break;
    case "widget:update":
      if (msg.payload) {
        const prev = useStatusBarStore.getState().widgets;
        useStatusBarStore.getState().setWidgets(msg.payload);
        const above = msg.payload.aboveEditor ?? {};
        const prevAbove = prev.aboveEditor ?? {};
        const hadCenterWidgets = hasVisibleWidgets(prevAbove);
        const hasCenterWidgets = hasVisibleWidgets(above);
        if (hasCenterWidgets && !hadCenterWidgets) {
          useExtensionUiStore.getState().setExtensionPanelDismissed(false);
        }
      }
      break;
    case "ui:snapshot":
      if (msg.payload) applyStatusPayload(msg.payload);
      // Note: resumeAgentRun is already called inside applyStatusPayload when
      // agentRunning is true — do not call it again here to avoid creating a
      // duplicate streaming assistant before chat:history has loaded.
      break;
    case "extension_ui:request": {
      const req = msg.payload as ExtensionUIRequest;
      if (!req?.method) break;
      switch (req.method) {
        case "select":
        case "confirm":
        case "input":
        case "editor":
          useExtensionUiStore.getState().setExtensionPanelDismissed(false);
          useExtensionUiStore.getState().setDialog({
            id: req.id,
            method: req.method,
            title: req.title,
            message: req.message,
            options: req.options,
            placeholder: req.placeholder,
            prefill: req.prefill,
          });
          break;
        case "notify":
          if (req.message) useNotificationStore.getState().notify(req.message, "info");
          break;
        case "setTitle":
          if (req.title) document.title = req.title;
          break;
        case "set_editor_text":
          useExtensionUiStore.getState().setComposerDraft(req.text ?? "");
          useComposerFocusStore.getState().requestFocus(req.text ?? "");
          break;
        default:
          break;
      }
      break;
    }
    case "slash:result": {
      const slashStore = useSlashStore.getState();
      slashStore.close();
      slashStore.setLastResult(msg.payload);
      if (msg.payload?.message) {
        useNotificationStore.getState().notify(msg.payload.message, "success");
      }
      if (msg.payload?.command === "session.copy" && msg.payload?.data?.text) {
        void copyTextToClipboard(String(msg.payload.data.text));
      }
      const replacementCommands = ["session.new", "session.resume", "session.fork", "session.importJsonl"];
      if (replacementCommands.includes(msg.payload?.command) && msg.payload?.data?.sessionId) {
        useSessionStore.getState().setActiveSession(msg.payload.data.sessionId);
        useSessionStore.getState().fetchSessions();
        if (msg.payload.command === "session.new" || msg.payload.command === "session.resume") {
          useComposerFocusStore.getState().requestFocus();
        }
        if (msg.payload.command === "session.fork" && msg.payload?.data?.selectedText) {
          useComposerFocusStore.getState().requestFocus(String(msg.payload.data.selectedText));
        } else if (msg.payload.command === "session.fork") {
          useComposerFocusStore.getState().requestFocus();
        }
      }
      if (msg.payload?.command === "session.navigateTree" && msg.payload?.data?.editorText) {
        useComposerFocusStore.getState().requestFocus(String(msg.payload.data.editorText));
      }
      if (msg.payload?.command === "session.reload" && msg.payload?.ok) {
        // Immediately update dynamic commands from the response payload
        if (msg.payload?.data?.dynamic) {
          useSlashStore.getState().setDynamicCommands(msg.payload.data.dynamic);
        }
        // Also re-fetch the full command list for correctness
        apiGet<{ system: SlashCommand[]; dynamic: SlashCommand[] }>("/api/slash/commands")
          .then((data) => {
            if (data.system?.length) useSlashStore.getState().setCommands(data.system);
            useSlashStore.getState().setDynamicCommands(data.dynamic || []);
          })
          .catch(() => {});
      }
      break;
    }
    case "slash:error": {
      const errMsg = msg.payload?.message || "Slash command failed";
      console.error("Slash error:", errMsg);
      useNotificationStore.getState().notify(errMsg, "info");
      break;
    }
  }
}

const NON_IDEMPOTENT_TYPES = new Set(['chat:prompt', 'chat:steer', 'chat:followup']);

/** Keeps the WS alive for the workspace — mount once in WorkspaceLayout. */
export function useChatWebSocket(): ChatWebSocketApi {
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<{ type: string; payload: unknown }[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const sessionId = useAuthStore((s) => s.sessionId);
  const userId = useAuthStore((s) => s.userId);
  const piSessionId = useSessionStore((s) => s.activePiSessionId);
  const isGuestView = userId === "__guest__";

  const send = useCallback((type: string, payload: unknown = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    // Queue for reconnection: keep only latest of non-idempotent types
    if (NON_IDEMPOTENT_TYPES.has(type)) {
      messageQueueRef.current = messageQueueRef.current.filter(
        m => !NON_IDEMPOTENT_TYPES.has(m.type)
      );
    }
    messageQueueRef.current.push({ type, payload });
    return false;
  }, []);

  useComposerLayoutSync(useCallback(
    (widgetRenderWidth) => send("ui:set_layout", { widgetRenderWidth }),
    [send]
  ));

  useEffect(() => {
    if (!piSessionId) {
      setConnectionState('disconnected');
      return;
    }
    // 正常模式需要 sessionId，访客模式不需要
    if (!isGuestView && !sessionId) {
      setConnectionState('disconnected');
      return;
    }

    const boundPiSessionId = piSessionId;
    const needsBootstrap = useChatStore.getState().hydratedPiSessionId !== boundPiSessionId;

    let disposed = false;
    let finished = !needsBootstrap;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;
    let activeWs: WebSocket | null = null;

    function finishHydration() {
      if (disposed || finished || !needsBootstrap) return;
      if (useSessionStore.getState().activePiSessionId !== boundPiSessionId) return;
      useChatStore.getState().completeHydration(boundPiSessionId);
      finished = true;
      // Reset reconnect backoff — transport is working and session is usable
      reconnectAttempt = 0;
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    }

    if (needsBootstrap) {
      fallbackTimer = setTimeout(() => {
        // Don't finish hydration while reconnecting — history may still arrive
        if (!disposed) {
          finishHydration();
        }
      }, HYDRATION_FALLBACK_MS);
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== undefined) return;
      setConnectionState('reconnecting');
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
      reconnectAttempt += 1;
      // After too many failed attempts (e.g. server restart invalidated auth
      // session), reload to get fresh credentials instead of looping forever.
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket reconnect failed after', reconnectAttempt, 'attempts — reloading');
        window.location.reload();
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!disposed) connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      if (useSessionStore.getState().activePiSessionId !== boundPiSessionId) return;

      setConnectionState('connecting');
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = isGuestView
        ? `${protocol}//${location.host}/ws/chat?view=1&piSessionId=${boundPiSessionId}`
        : `${protocol}//${location.host}/ws/chat?sessionId=${sessionId}&piSessionId=${boundPiSessionId}`;
      const ws = new WebSocket(wsUrl);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        // Do NOT reset reconnectAttempt here — a transport-level open does
        // not guarantee the session is usable. Only reset on successful
        // hydration (chat:history received). This ensures the page-reload
        // escape hatch triggers after MAX_RECONNECT_ATTEMPTS consecutive
        // failures, even when the transport opens each time.
        setConnectionState('connected');
        // Take a snapshot of the queue and clear it — queued messages will
        // be replayed once chat:history has loaded to avoid injecting stale
        // prompts before the transcript is ready.
        const pendingQueue = messageQueueRef.current.slice();
        messageQueueRef.current = [];
        ws.send(JSON.stringify({ type: "ui:request_snapshot", payload: {} }));
        // After the snapshot round-trip, drain any queued messages that
        // accumulated during or before reconnection.
        const drain = () => {
          // Merge any messages queued while waiting for history
          const merged = [...pendingQueue, ...messageQueueRef.current];
          messageQueueRef.current = [];
          // Deduplicate: keep only latest of non-idempotent types
          const seen = new Set<string>();
          const filtered = merged.filter(m => {
            if (NON_IDEMPOTENT_TYPES.has(m.type)) {
              if (seen.has(m.type)) return false;
              seen.add(m.type);
            }
            return true;
          });
          for (const m of filtered) {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: m.type, payload: m.payload }));
            }
          }
        };
        // Drain on the first non-history, non-snapshot message — this means
        // the snapshot round-trip has completed and the transcript is ready.
        let drained = false;
        const origOnMessage = ws.onmessage;
        ws.onmessage = (event) => {
          origOnMessage?.call(ws, event);
          if (!drained) {
            let msg: { type: string } | null = null;
            try { msg = JSON.parse(event.data); } catch { /* ignore */ }
            if (msg && msg.type !== 'chat:history' && msg.type !== 'ui:snapshot') {
              drained = true;
              drain();
            }
          }
        };
        // Fallback: drain after a short delay even if no new message arrives
        setTimeout(() => {
          if (!drained && !disposed) {
            drained = true;
            drain();
          }
        }, 500);
      };

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;
        let msg: { type: string; payload: any };
        try { msg = JSON.parse(event.data); } catch { return; }
        dispatchWsMessage(msg, boundPiSessionId, finishHydration);
      };

      ws.onerror = () => {
        // onclose handles reconnect — avoid finishing hydration on a transient blip.
      };

      ws.onclose = () => {
        if (activeWs === ws) activeWs = null;
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) return;
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      disposed = true;
      messageQueueRef.current = [];
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (activeWs) {
        activeWs.onopen = null;
        activeWs.onmessage = null;
        activeWs.onerror = null;
        activeWs.onclose = null;
        activeWs.close();
      }
      if (wsRef.current === activeWs) wsRef.current = null;
    };
  }, [sessionId, piSessionId, isGuestView]);

  return {
    sendPrompt: (text: string, images?: { mediaType: string; data: string }[]) =>
      send("chat:prompt", { text, images }),
    sendSteer: (text: string) => send("chat:steer", { text }),
    sendFollowUp: (text: string) => send("chat:followup", { text }),
    sendAbort: () => send("chat:abort"),
    sendDequeue: () => send("chat:dequeue"),
    sendSlash: (command: string, args?: Record<string, unknown>) =>
      send("slash:execute", { command, args }),
    sendExtensionUiResponse: (response: {
      id: string;
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    }) => send("extension_ui:response", response),
    connectionState,
  };
}
