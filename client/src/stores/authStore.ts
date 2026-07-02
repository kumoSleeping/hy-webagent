import { create } from "zustand";
import type { AccountProfile, LoginResponse } from "../types";
import { setSessionId } from "../lib/api";
import { useChatStore } from "./chatStore";
import { useSessionStore } from "./sessionStore";
import { useStatusBarStore } from "./statusBarStore";

// ── cookie helpers ───────────────────────────────────

const COOKIE_NAME = "pi-api-key";
const COOKIE_DAYS = 1;

function setCookie(value: string) {
  const d = new Date();
  d.setTime(d.getTime() + COOKIE_DAYS * 24 * 60 * 60 * 1000);
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

function getCookie(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function clearCookie() {
  document.cookie = `${COOKIE_NAME}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

// ── store ────────────────────────────────────────────

interface AuthState {
  sessionId: string | null;
  userId: string | null;
  displayName: string | null;
  username: string | null;
  role: "user" | "admin";
  tokensUsed: number;
  budgetUsd: number | null;
  budgetUsedUsd: number;
  budgetRemainingUsd: number | null;
  budgetUnlimited: boolean;
  isLoggedIn: boolean;
  isLoading: boolean;
  error: string | null;

  login: (apiKey: string) => Promise<boolean>;
  tryAutoLogin: () => Promise<boolean>;
  logout: () => Promise<void>;
  applyProfile: (profile: AccountProfile) => void;
  updateTokens: (used: number) => void;
  updateBudgetFromToken: (payload: {
    budgetUsd?: number | null;
    budgetUsedUsd?: number;
    budgetRemainingUsd?: number | null;
    budgetUnlimited?: boolean;
    totalUsed?: number;
  }) => void;
  clearError: () => void;
}

const _hasCookie = typeof document !== "undefined" && !!getCookie();

let autoLoginPromise: Promise<boolean> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  sessionId: null,
  userId: null,
  displayName: null,
  username: null,
  role: "user",
  tokensUsed: 0,
  budgetUsd: null,
  budgetUsedUsd: 0,
  budgetRemainingUsd: null,
  budgetUnlimited: false,
  isLoggedIn: false,
  isLoading: _hasCookie,
  error: null,

  applyProfile: (profile) =>
    set({
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      role: profile.role,
      tokensUsed: profile.tokensUsed,
      budgetUsd: profile.budgetUsd,
      budgetUsedUsd: profile.budgetUsedUsd,
      budgetRemainingUsd: profile.budgetRemainingUsd,
      budgetUnlimited: profile.budgetUnlimited,
    }),

  tryAutoLogin: async () => {
    if (get().isLoggedIn) return true;
    if (autoLoginPromise) return autoLoginPromise;

    autoLoginPromise = (async () => {
      const key = getCookie();
      if (!key) {
        set({ isLoading: false });
        return false;
      }
      return get().login(key);
    })();

    try {
      return await autoLoginPromise;
    } finally {
      autoLoginPromise = null;
    }
  },

  login: async (apiKey: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Login failed" }));
        set({ isLoading: false, error: data.error || "Login failed" });
        return false;
      }
      const data: LoginResponse = await res.json().catch(() => {
        throw new Error("Empty response from login");
      });
      setCookie(apiKey); // persist 1 day
      set({
        sessionId: data.sessionId,
        isLoggedIn: true,
        isLoading: false,
        error: null,
      });
      get().applyProfile(data);
      return true;
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message });
      return false;
    }
  },

  logout: async () => {
    const sessionId = get().sessionId;
    if (sessionId) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch {
        // Local logout still proceeds if the server is unreachable.
      }
    }

    clearCookie();
    setSessionId(null);
    useChatStore.getState().resetForSessionChange();
    useStatusBarStore.getState().clear();
    useSessionStore.setState({ sessions: [], activePiSessionId: null, loading: false });
    set({
      sessionId: null,
      userId: null,
      displayName: null,
      username: null,
      role: "user",
      tokensUsed: 0,
      budgetUsd: null,
      budgetUsedUsd: 0,
      budgetRemainingUsd: null,
      budgetUnlimited: false,
      isLoggedIn: false,
      error: null,
      isLoading: false,
    });
  },

  updateTokens: (used) => set({ tokensUsed: used }),

  updateBudgetFromToken: (payload) =>
    set((s) => ({
      tokensUsed: payload.totalUsed ?? s.tokensUsed,
      budgetUsd: payload.budgetUsd !== undefined ? payload.budgetUsd : s.budgetUsd,
      budgetUsedUsd: payload.budgetUsedUsd ?? s.budgetUsedUsd,
      budgetRemainingUsd:
        payload.budgetRemainingUsd !== undefined ? payload.budgetRemainingUsd : s.budgetRemainingUsd,
      budgetUnlimited: payload.budgetUnlimited ?? s.budgetUnlimited,
    })),
  clearError: () => set({ error: null }),
}));
