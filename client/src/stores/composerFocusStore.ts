import { create } from "zustand";

interface ComposerFocusState {
  /** Incremented each time something requests composer focus */
  focusTick: number;
  /** Text to drop into the composer the next time focus is requested — used
   * when e.g. navigating the session tree back to a user message hands the
   * message text back for editing instead of just discarding it. */
  pendingText: string | null;
  requestFocus: (text?: string) => void;
}

export const useComposerFocusStore = create<ComposerFocusState>((set) => ({
  focusTick: 0,
  pendingText: null,
  requestFocus: (text) => set((s) => ({ focusTick: s.focusTick + 1, pendingText: text ?? null })),
}));
