import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../stores/authStore";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import { useChatBootstrapping } from "./useChatBootstrapping";
import { useChatSessionRoute } from "./useChatSessionRoute";

const SESSION = "019f1fab-9152-74f1-b928-c553d057c0e8";

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/auth/login") && method === "POST") {
      return new Response(
        JSON.stringify({
          sessionId: "auth-sess",
          userId: "user-1",
          displayName: "Test",
          username: "test",
          role: "user",
          tokensUsed: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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

function Harness() {
  const route = useChatSessionRoute();
  const bootstrapping = useChatBootstrapping(route);
  return { route, bootstrapping };
}

describe("useChatSessionRoute", () => {
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    document.cookie = "pi-api-key=test-key; path=/";
    useAuthStore.setState({
      sessionId: null,
      userId: null,
      displayName: null,
      username: null,
      role: "user",
      tokensUsed: 0,
      isLoggedIn: false,
      isLoading: true,
      error: null,
    });
    useSessionStore.setState({ sessions: [], activePiSessionId: null, loading: false });
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      currentAssistantId: null,
      queuedSteering: [],
      queuedFollowUp: [],
      hydratedPiSessionId: null,
    });
    fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    document.cookie = "pi-api-key=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("finishes bootstrapping for /chat/:sessionId after login + init + activate", async () => {
    await useAuthStore.getState().tryAutoLogin();

    const { result } = renderHook(() => Harness(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[`/chat/${SESSION}`]}>{children}</MemoryRouter>
      ),
    });

    await new Promise((r) => setTimeout(r, 500));
    const calls = fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${String(input)}`);
    const snapshot = {
      bootstrapping: result.current.bootstrapping,
      route: result.current.route,
      activePiSessionId: useSessionStore.getState().activePiSessionId,
      authSessionId: useAuthStore.getState().sessionId,
      fetchCalls: calls,
    };
    expect(snapshot, JSON.stringify(snapshot, null, 2)).toEqual(
      expect.objectContaining({
        bootstrapping: false,
        activePiSessionId: SESSION,
      })
    );
  });

  it("does not stay bootstrapping when URL session is already hydrated (line 112 guard)", async () => {
    await useAuthStore.getState().tryAutoLogin();
    useChatStore.getState().completeHydration(SESSION);

    const { result } = renderHook(() => Harness(), {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[`/chat/${SESSION}`]}>{children}</MemoryRouter>
      ),
    });

    await waitFor(
      () => {
        expect(result.current.route.routeReady).toBe(true);
      },
      { timeout: 5000 }
    );

    // Simulate the stale-ref path: hydrated matches URL but active session not set yet.
    await waitFor(
      () => {
        expect(result.current.bootstrapping).toBe(false);
      },
      { timeout: 5000 }
    );
  });
});
