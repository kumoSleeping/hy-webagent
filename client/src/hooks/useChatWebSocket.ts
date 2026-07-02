import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { useSessionStore } from "../stores/sessionStore";
import { useSlashStore } from "../stores/slashStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useComposerFocusStore } from "../stores/composerFocusStore";
import { useStatusBarStore } from "../stores/statusBarStore";
import { useExtensionUiStore } from "../stores/extensionUiStore";
import { resolveBtwTurnId, useBtwStore } from "../stores/btwStore";
import { useComposerPanelStore } from "../stores/composerPanelStore";
import { hasVisibleWidgets } from "../components/extension-ui/ExtensionWidgetBody";
import { applyStatusPayload } from "./useStatusBarSync";
import { useComposerLayoutSync } from "./useComposerLayoutSync";
import { copyTextToClipboard } from "../lib/copyToClipboard";
import type { ExtensionUIRequest } from "../types/extension-ui";
import { apiGet } from "../lib/api";
import type { SlashCommand } from "../stores/slashStore";

const HYDRATION_FALLBACK_MS = 8_000;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;

export interface ChatWebSocketApi {
  sendPrompt: (text: string, images?: { mediaType: string; data: string }[]) => void;
  sendSteer: (text: string) => void;
  sendFollowUp: (text: string) => void;
  sendAbort: () => void;
  sendDequeue: () => void;
  sendSlash: (command: string, args?: Record<string, unknown>) => void;
  sendExtensionUiResponse: (response: {
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
  sendBtwAsk: (question: string) => void;
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
      const alreadyHydrated =
        store().hydratedPiSessionId === boundPiSessionId && store().messages.length > 0;
      if (alreadyHydrated) {
        if (agentRunning) store().resumeAgentRun();
      } else {
        store().loadHistory(messages, { agentRunning });
      }
      finishHydration();
      break;
    }
    case "chat:text_delta": {
      const aid = store().ensureStreamingAssistant();
      store().appendTextDelta(aid, msg.payload.delta);
      break;
    }
    case "chat:thinking_delta": {
      const aid = store().ensureStreamingAssistant();
      store().appendThinkingDelta(aid, msg.payload.delta);
      break;
    }
    case "chat:tool_start": {
      const aid = store().ensureStreamingAssistant();
      store().addToolCall(aid, {
        toolCallId: msg.payload.toolCallId,
        toolName: msg.payload.toolName,
        input: msg.payload.input,
        status: "running",
      });
      break;
    }
    case "chat:tool_update": {
      const aid = store().currentAssistantId ?? store().ensureStreamingAssistant();
      store().updateToolCall(aid, msg.payload.toolCallId, msg.payload.output);
      break;
    }
    case "chat:tool_end": {
      const aid = store().currentAssistantId ?? store().ensureStreamingAssistant();
      store().endToolCall(
        aid,
        msg.payload.toolCallId,
        msg.payload.isError,
        msg.payload.details,
        msg.payload.output
      );
      break;
    }
    case "chat:agent_start":
      store().startAssistantMessage();
      break;
    case "chat:agent_end": {
      const aid =
        store().currentAssistantId ??
        store().messages.find((m) => m.isStreaming)?.id ??
        null;
      if (aid) {
        store().finalizeRunningToolCalls(aid);
        store().finishAssistantMessage(aid);
      } else {
        store().setStreaming(false);
      }
      break;
    }
    case "chat:error":
      console.error("Chat error:", msg.payload.message);
      store().setStreaming(false);
      useNotificationStore.getState().notify(msg.payload.message || "Chat error", "info");
      break;
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
      if (msg.payload?.agentRunning) store().resumeAgentRun();
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
    case "btw:start": {
      const question = String(msg.payload?.question ?? "").trim();
      if (!question) break;
      if (!useComposerPanelStore.getState().btwPanelSuppressed) {
        useComposerPanelStore.getState().openBtwPanel();
      }
      const { turns } = useBtwStore.getState();
      const exists = turns.some((t) => t.question === question && (t.pending || t.answer || t.error));
      if (!exists) useBtwStore.getState().ensureTurn(question);
      break;
    }
    case "btw:text_delta": {
      const turnId = resolveBtwTurnId(msg.payload?.question);
      if (turnId && msg.payload?.delta) {
        useBtwStore.getState().appendDelta(turnId, String(msg.payload.delta));
      }
      break;
    }
    case "btw:agent_start": {
      const turnId = resolveBtwTurnId(msg.payload?.question);
      if (turnId) useBtwStore.getState().setPending(turnId, true);
      break;
    }
    case "btw:agent_end":
      // Keep pending until btw:end/btw:error — agent_end can arrive before any text_delta.
      break;
    case "btw:end": {
      const turnId = resolveBtwTurnId(msg.payload?.question);
      if (turnId) {
        useBtwStore.getState().finishTurn(turnId, String(msg.payload?.answer ?? ""));
      }
      break;
    }
    case "btw:error": {
      const turnId = resolveBtwTurnId(msg.payload?.question);
      const message = String(msg.payload?.message ?? "Side question failed");
      if (turnId) {
        useBtwStore.getState().failTurn(turnId, message);
      } else {
        useNotificationStore.getState().notify(message, "info");
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

/** Keeps the WS alive for the workspace — mount once in WorkspaceLayout. */
export function useChatWebSocket(): ChatWebSocketApi {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionId = useAuthStore((s) => s.sessionId);
  const piSessionId = useSessionStore((s) => s.activePiSessionId);

  const send = useCallback((type: string, payload: unknown = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);

  useComposerLayoutSync(useCallback(
    (widgetRenderWidth) => send("ui:set_layout", { widgetRenderWidth }),
    [send]
  ));

  useEffect(() => {
    if (!sessionId || !piSessionId) return;

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
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    }

    if (needsBootstrap) {
      fallbackTimer = setTimeout(finishHydration, HYDRATION_FALLBACK_MS);
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer !== undefined) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!disposed) connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      if (useSessionStore.getState().activePiSessionId !== boundPiSessionId) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${location.host}/ws/chat?sessionId=${sessionId}&piSessionId=${boundPiSessionId}`
      );
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        reconnectAttempt = 0;
        ws.send(JSON.stringify({ type: "ui:request_snapshot", payload: {} }));
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
  }, [sessionId, piSessionId]);

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
    sendBtwAsk: (question: string) => send("btw:ask", { question }),
  };
}
