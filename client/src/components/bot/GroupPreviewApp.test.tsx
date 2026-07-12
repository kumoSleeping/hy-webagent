import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupPreviewApp } from "./GroupPreviewApp";
import { useGroupPreview } from "./GroupPreviewContext";
import { useSessionStore } from "../../stores/sessionStore";

vi.mock("../../hooks/useChatWebSocket", () => ({
  useChatWebSocket: () => ({ connectionState: "disconnected" }),
}));

vi.mock("../workspace/WorkspaceLayout", () => ({
  WorkspaceLayout: () => {
    const group = useGroupPreview();
    return <div data-testid="workspace">{group?.channelDisplayName}</div>;
  },
}));

describe("GroupPreviewApp", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activePiSessionId: null, loading: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      bot: { slug: "kgy", displayName: "Kaguya" },
      channel: { channelId: "257247983", displayName: "测试群" },
      sessions: [
        { piSessionId: "latest", title: "最新问题", createdAt: 2, updatedAt: 3 },
        { piSessionId: "older", title: "之前的问题", createdAt: 1, updatedAt: 1 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });

  it("opens the latest public group session in the real workspace and publishes group history", async () => {
    render(
      <BrowserRouter>
        <GroupPreviewApp botSlug="kgy" channelId="257247983" />
      </BrowserRouter>,
    );

    expect(await screen.findByTestId("workspace")).toHaveTextContent("测试群");
    await waitFor(() => {
      expect(useSessionStore.getState().activePiSessionId).toBe("latest");
      expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual(["latest", "older"]);
    });
  });

});
