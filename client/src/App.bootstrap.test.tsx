import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAuthStore } from "./stores/authStore";
import { useSessionStore } from "./stores/sessionStore";
import { useChatStore } from "./stores/chatStore";
import { setGlobalLoaderActive } from "./lib/globalLoader";

const SESSION = "019f1fab-9152-74f1-b928-c553d057c0e8";

const PROFILE = {
  userId: "user-1",
  displayName: "Test",
  username: "test",
  role: "user" as const,
  tokensUsed: 0,
  budgetUsd: 2,
  budgetUsedUsd: 0,
  budgetRemainingUsd: 2,
  budgetUnlimited: false,
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    const url = raw.startsWith("http") ? raw : `http://localhost${raw.startsWith("/") ? raw : `/${raw}`}`;
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/auth/login") && method === "POST") {
      return new Response(
        JSON.stringify({ sessionId: "auth-sess", ...PROFILE }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/api/auth/me") && method === "GET") {
      return new Response(JSON.stringify(PROFILE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/workspace/init") && method === "POST") {
      return new Response(JSON.stringify({ workspacePath: "/tmp/ws" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/sessions") && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith(`/api/sessions/${SESSION}/activate`) && method === "POST") {
      return new Response(JSON.stringify({ sessionId: SESSION }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith(`/api/sessions/${encodeURIComponent(SESSION)}/status`)) {
      return new Response(
        JSON.stringify({ footer: {}, widgets: {}, plugins: {}, agentRunning: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("App bootstrap", () => {
  beforeEach(() => {
    document.cookie = "pi-api-key=test-key; path=/";
    window.history.replaceState({}, "", `/chat/${SESSION}`);
    if (!document.getElementById("pi-global-loader")) {
      const loader = document.createElement("div");
      loader.id = "pi-global-loader";
      document.body.appendChild(loader);
    }
    document.getElementById("pi-global-loader")?.classList.remove("pi-loading-gate--active");
    useAuthStore.setState({
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
      isLoading: true,
      error: null,
    });
    useSessionStore.setState({ sessions: [], activePiSessionId: null, loading: false });
    useChatStore.setState({ hydratedPiSessionId: null });
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    document.cookie = "pi-api-key=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setGlobalLoaderActive(false);
  });

  it("clears the global loader on /chat/:sessionId after bootstrap (StrictMode)", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(
      () => {
        expect(useSessionStore.getState().activePiSessionId).toBe(SESSION);
      },
      { timeout: 8000 }
    );

    // Simulate chat hydration so the global loader clears (gate checks !hydratedPiSessionId).
    useChatStore.getState().completeHydration(SESSION);

    await waitFor(
      () => {
        expect(document.getElementById("pi-global-loader")?.classList.contains("pi-loading-gate--active")).toBe(false);
      },
      { timeout: 2000 }
    );
  });
});
