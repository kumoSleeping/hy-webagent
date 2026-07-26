import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { navigateToSession } from "../lib/sessionNavigation";
import { useChatStore } from "./chatStore";
import { peekChatStore } from "./chatStores";
import { useStatusBarStore } from "./statusBarStore";

export interface SessionSummary {
  id: string;
  title: string;
  timestamp: string;
  messageCount: number;
}

interface SessionOptions {
  /** When false, skip updating the browser URL (used while applying URL → store). */
  syncUrl?: boolean;
}

interface SessionState {
  sessions: SessionSummary[];
  activePiSessionId: string | null;
  loading: boolean;

  fetchSessions: () => Promise<void>;
  createSession: (options?: SessionOptions) => Promise<string | null>;
  activateSession: (piSessionId: string, options?: SessionOptions) => Promise<string | null>;
  setActiveSession: (piSessionId: string | null, options?: SessionOptions) => void;
  deleteSession: (piSessionId: string) => Promise<void>;
}

function maybeSyncUrl(sessionId: string | null, syncUrl: boolean | undefined) {
  if (syncUrl !== false && sessionId) {
    navigateToSession(sessionId);
  }
}

function onPiSessionChange(prev: string | null, next: string | null) {
  // 根治「聚焦小窗会话闪一下」:目标会话开着小窗且已水合时,把小窗的
  // transcript 无缝克隆进单例 —— 不清屏、不闪;随后主链路推来的
  // chat:history 静默对账(无 id 消息的 h-<位置> 稳定 id 保证零跳动)。
  const windowStore = next ? peekChatStore(next) : null;
  const windowState = windowStore?.getState();
  if (next && windowState && windowState.hydratedPiSessionId === next) {
    useChatStore.setState({
      messages: windowState.messages,
      isStreaming: windowState.isStreaming,
      currentAssistantId: windowState.currentAssistantId,
      queuedSteering: windowState.queuedSteering,
      queuedFollowUp: windowState.queuedFollowUp,
      hydratedPiSessionId: next,
    });
  } else {
    useChatStore.getState().resetForSessionChange();
  }
  if (prev !== null) useStatusBarStore.getState().clear();
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activePiSessionId: null,
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const data = await apiGet<SessionSummary[]>("/api/sessions");
      set({ sessions: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createSession: async (options) => {
    try {
      const data = await apiPost<{ sessionId: string }>("/api/sessions/create");
      const id = data.sessionId;
      const prev = get().activePiSessionId;
      set({ activePiSessionId: id });
      if (prev !== id) onPiSessionChange(prev, id);
      maybeSyncUrl(id, options?.syncUrl);
      return id;
    } catch (err) {
      console.error("createSession failed:", err);
      // 把服务端原因带给用户(如「直播会话已达上限(8),请先关闭一些
      // 会话小窗」),不要只说失败。
      const msg = err instanceof Error && err.message ? err.message : "";
      useStatusBarStore
        .getState()
        .setFlash(msg ? `新建会话失败：${msg}` : "新建会话失败", "error");
      return null;
    }
  },

  activateSession: async (piSessionId, options) => {
    try {
      const data = await apiPost<{ sessionId: string }>(`/api/sessions/${piSessionId}/activate`);
      const prev = get().activePiSessionId;
      set({ activePiSessionId: data.sessionId });
      if (prev !== data.sessionId) onPiSessionChange(prev, data.sessionId);
      get().fetchSessions();
      maybeSyncUrl(data.sessionId, options?.syncUrl);
      return data.sessionId;
    } catch (err) {
      console.error("activateSession failed:", err);
      return null;
    }
  },

  setActiveSession: (piSessionId, options) => {
    const prev = get().activePiSessionId;
    set({ activePiSessionId: piSessionId });
    if (prev !== piSessionId) onPiSessionChange(prev, piSessionId);
    maybeSyncUrl(piSessionId, options?.syncUrl);
  },

  deleteSession: async (piSessionId) => {
    try {
      await apiDelete(`/api/sessions/${piSessionId}`);
      set((s) => ({
        sessions: s.sessions.filter(sess => sess.id !== piSessionId),
        activePiSessionId: s.activePiSessionId === piSessionId ? null : s.activePiSessionId,
      }));
    } catch (err) {
      console.error("deleteSession failed:", err);
    }
  },
}));
