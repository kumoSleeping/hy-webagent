import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "../lib/api";
import { navigateToSession } from "../lib/sessionNavigation";
import { useChatStore } from "./chatStore";
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

function onPiSessionChange(prev: string | null, _next: string | null) {
  useChatStore.getState().resetForSessionChange();
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
