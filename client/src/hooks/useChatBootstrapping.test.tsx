import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach } from "vitest";
import { useChatBootstrapping } from "./useChatBootstrapping";
import { useSessionStore } from "../stores/sessionStore";

describe("useChatBootstrapping", () => {
  beforeEach(() => {
    useSessionStore.setState({ activePiSessionId: null });
  });

  it("is true until route is ready and a session is active", () => {
    const { result, rerender } = renderHook(
      ({ routeReady, isSyncingSession }) =>
        useChatBootstrapping({ routeReady, isSyncingSession }),
      {
        initialProps: { routeReady: false, isSyncingSession: false },
        wrapper: ({ children }) => <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>,
      }
    );

    expect(result.current).toBe(true);

    rerender({ routeReady: true, isSyncingSession: false });
    expect(result.current).toBe(true);

    useSessionStore.setState({ activePiSessionId: "sess-a" });
    rerender({ routeReady: true, isSyncingSession: false });
    expect(result.current).toBe(false);
  });

  it("stays true while the URL session is still syncing", () => {
    useSessionStore.setState({ activePiSessionId: "sess-a" });

    const { result } = renderHook(
      () => useChatBootstrapping({ routeReady: true, isSyncingSession: true }),
      {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={["/chat/other-id"]}>{children}</MemoryRouter>
        ),
      }
    );

    expect(result.current).toBe(true);
  });

  it("clears when the store already matches the URL path", () => {
    useSessionStore.setState({ activePiSessionId: "sess-a" });

    const { result } = renderHook(
      () => useChatBootstrapping({ routeReady: false, isSyncingSession: true }),
      {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={["/chat/sess-a"]}>{children}</MemoryRouter>
        ),
      }
    );

    expect(result.current).toBe(false);
  });
});
