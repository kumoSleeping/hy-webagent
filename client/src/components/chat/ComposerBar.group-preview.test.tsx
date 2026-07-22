import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerBar } from "./ComposerBar";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useSessionStore } from "../../stores/sessionStore";
import { ChatWebSocketProvider } from "../../context/chatWebSocketContext";
import type { ChatWebSocketApi } from "../../hooks/useChatWebSocket";

const noop = () => {};
const connectedApi = {
  connectionState: "connected",
} as ChatWebSocketApi;

describe("ComposerBar group preview", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    useComposerPanelStore.getState().closeAll();
    useSessionStore.setState({
      sessions: [
        { id: "newest", title: "最新会话", timestamp: "2026-07-12T00:00:00.000Z", messageCount: 1 },
        { id: "older", title: "历史会话", timestamp: "2026-07-11T00:00:00.000Z", messageCount: 1 },
      ],
      activePiSessionId: "newest",
      loading: false,
    });
  });

  it("accepts draft input while the session is still connecting", () => {
    render(
      <ComposerBar
        sendDisabled
        onSend={noop}
        onNewChat={noop}
        onFileClick={noop}
      />,
    );

    const editor = screen.getByRole("textbox");
    expect(editor).toHaveAttribute("data-placeholder", "Preparing...");
    expect(editor).not.toHaveAttribute("aria-disabled", "true");
    editor.focus();
    expect(editor).toHaveFocus();
    editor.textContent = "第一个字";
    fireEvent.input(editor, { inputType: "insertText" });
    expect(editor).toHaveTextContent("第一个字");
    expect(editor).toHaveFocus();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("handles a third-party input event without losing the live caret", () => {
    const onSend = vi.fn();
    render(
      <ChatWebSocketProvider value={connectedApi}>
        <ComposerBar onSend={onSend} onNewChat={noop} onFileClick={noop} />
      </ChatWebSocketProvider>,
    );

    const editor = screen.getByRole("textbox");
    editor.focus();
    editor.textContent = "甲乙";
    const range = document.createRange();
    range.setStart(editor.firstChild!, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.input(editor, { inputType: "insertText", isComposing: false });

    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(screen.getByLabelText("Send message")).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(onSend).toHaveBeenCalledWith("甲乙", undefined, "甲乙");
  });

  it("keeps the normal composer chrome but exposes only read-only group actions", async () => {
    const onReturnToChat = vi.fn();
    render(
      <ComposerBar
        disabled
        onSend={noop}
        onNewChat={noop}
        onFileClick={noop}
        modelContent={<div>model</div>}
        groupPreview={{
          notice: "Group chat only...",
          onReturnToChat,
          onSelectSession: (sessionId) => {
            useSessionStore.getState().setActiveSession(sessionId, { syncUrl: false });
          },
          filesContent: <div>文件不可操作</div>,
          accountContent: <div>群组用户信息</div>,
        }}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("button").filter((button) =>
      ["Toggle model selector", "Toggle history", "Toggle files", "Toggle account panel", "返回正常聊天"]
        .includes(button.getAttribute("aria-label") ?? ""),
    )).toHaveLength(5);
    expect(screen.queryByLabelText("Toggle commands")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New chat")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle files"));
    expect(screen.getByText("文件不可操作")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Toggle history"));
    fireEvent.click(screen.getByRole("button", { name: /历史会话/ }));
    await waitFor(() => expect(useSessionStore.getState().activePiSessionId).toBe("older"));
    expect(window.location.pathname).toBe("/");

    fireEvent.click(screen.getByLabelText("返回正常聊天"));
    expect(onReturnToChat).toHaveBeenCalledOnce();
  });
});
