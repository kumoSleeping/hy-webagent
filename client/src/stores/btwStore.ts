import { create } from "zustand";

export interface BtwTurn {
  id: string;
  question: string;
  answer: string;
  pending: boolean;
  error: string | null;
}

interface SessionBtwState {
  turns: BtwTurn[];
  activeTurnId: string | null;
}

interface BtwState {
  boundSessionId: string | null;
  /** Per-session side Q&A — survives switching back to a session in this tab. */
  bySession: Record<string, SessionBtwState>;
  turns: BtwTurn[];
  activeTurnId: string | null;
  bindSession: (sessionId: string | null) => void;
  startTurn: (question: string) => string;
  ensureTurn: (question: string) => string;
  appendDelta: (turnId: string, delta: string) => void;
  setPending: (turnId: string, pending: boolean) => void;
  finishTurn: (turnId: string, answer: string) => void;
  failTurn: (turnId: string, error: string) => void;
  clear: () => void;
}

let nextTurnId = 0;

function newTurnId(): string {
  nextTurnId += 1;
  return `btw-${nextTurnId}`;
}

const emptySessionState = (): SessionBtwState => ({ turns: [], activeTurnId: null });

function finalizePending(state: SessionBtwState, message: string): SessionBtwState {
  if (!state.turns.some((t) => t.pending)) return state;
  return {
    activeTurnId: null,
    turns: state.turns.map((t) =>
      t.pending ? { ...t, pending: false, error: t.error ?? message } : t
    ),
  };
}

function persistCurrent(get: () => BtwState, set: (partial: Partial<BtwState>) => void) {
  const { boundSessionId, turns, activeTurnId, bySession } = get();
  if (!boundSessionId) return;
  set({
    bySession: {
      ...bySession,
      [boundSessionId]: { turns, activeTurnId },
    },
  });
}

export const useBtwStore = create<BtwState>((set, get) => ({
  boundSessionId: null,
  bySession: {},
  turns: [],
  activeTurnId: null,

  bindSession(sessionId) {
    const prev = get().boundSessionId;
    if (prev === sessionId) return;

    const bySession = { ...get().bySession };
    if (prev) {
      const saved = finalizePending(
        { turns: get().turns, activeTurnId: get().activeTurnId },
        "Interrupted — session changed"
      );
      bySession[prev] = saved;
    }

    if (!sessionId) {
      set({ boundSessionId: null, bySession, ...emptySessionState() });
      return;
    }

    const next = bySession[sessionId] ?? emptySessionState();
    set({
      boundSessionId: sessionId,
      bySession,
      turns: next.turns,
      activeTurnId: next.activeTurnId,
    });
  },

  startTurn(question) {
    const id = newTurnId();
    set({
      activeTurnId: id,
      turns: [{ id, question, answer: "", pending: true, error: null }],
    });
    persistCurrent(get, (partial) => set(partial));
    return id;
  },

  ensureTurn(question) {
    const trimmed = question.trim();
    if (!trimmed) return "";
    const existing = get().turns.find((t) => t.question === trimmed && t.pending);
    if (existing) {
      if (get().activeTurnId !== existing.id) {
        set({ activeTurnId: existing.id });
        persistCurrent(get, (partial) => set(partial));
      }
      return existing.id;
    }
    return get().startTurn(trimmed);
  },

  appendDelta(turnId, delta) {
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === turnId ? { ...t, answer: t.answer + delta, pending: true } : t
      ),
    }));
    persistCurrent(get, (partial) => set(partial));
  },

  setPending(turnId, pending) {
    set((s) => ({
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, pending } : t)),
    }));
    persistCurrent(get, (partial) => set(partial));
  },

  finishTurn(turnId, answer) {
    set((s) => ({
      activeTurnId: s.activeTurnId === turnId ? null : s.activeTurnId,
      turns: s.turns.map((t) =>
        t.id === turnId
          ? { ...t, answer: answer || t.answer, pending: false, error: null }
          : t
      ),
    }));
    persistCurrent(get, (partial) => set(partial));
  },

  failTurn(turnId, error) {
    set((s) => ({
      activeTurnId: s.activeTurnId === turnId ? null : s.activeTurnId,
      turns: s.turns.map((t) =>
        t.id === turnId ? { ...t, pending: false, error } : t
      ),
    }));
    persistCurrent(get, (partial) => set(partial));
  },

  clear() {
    set({ turns: [], activeTurnId: null });
    persistCurrent(get, (partial) => set(partial));
  },
}));

export function resolveBtwTurnId(question?: string): string | null {
  const { turns, activeTurnId } = useBtwStore.getState();
  if (question) {
    const match = [...turns].reverse().find((t) => t.question === question);
    if (match) return match.id;
  }
  return activeTurnId;
}
