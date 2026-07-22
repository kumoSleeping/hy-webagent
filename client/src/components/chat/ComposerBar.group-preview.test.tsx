import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerBar } from "./ComposerBar";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useSessionStore } from "../../stores/sessionStore";

const noop = () => {};

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

    const textarea = screen.getByPlaceholderText("会话准备中，可以先输入…");
    expect(textarea).toBeEnabled();
    textarea.focus();
    expect(textarea).toHaveFocus();
    fireEvent.input(textarea, { target: { value: "第一个字" }, inputType: "insertText" });
    expect(textarea).toHaveValue("第一个字");
    expect(textarea).toHaveFocus();
    expect(screen.getByLabelText("Send message")).toBeDisabled();
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
          notice: "请到群聊中输入消息",
          onReturnToChat,
          onSelectSession: (sessionId) => {
            useSessionStore.getState().setActiveSession(sessionId, { syncUrl: false });
          },
          filesContent: <div>文件不可操作</div>,
          accountContent: <div>群组用户信息</div>,
        }}
      />,
    );

    expect(screen.getByPlaceholderText("请到群聊中输入消息")).toBeDisabled();
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
