import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerBar } from "./ComposerBar";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useSessionStore } from "../../stores/sessionStore";
import { ChatWebSocketProvider } from "../../context/chatWebSocketContext";
import type { ChatWebSocketApi } from "../../hooks/useChatWebSocket";
import type { PreparedAttachmentItem } from "../../lib/prepareAttachments";

const prepareSingleAttachmentMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/prepareAttachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/prepareAttachments")>();
  return { ...actual, prepareSingleAttachment: prepareSingleAttachmentMock };
});

const noop = () => {};
const connectedApi = {
  connectionState: "connected",
} as ChatWebSocketApi;
const connectingApi = {
  connectionState: "connecting",
} as ChatWebSocketApi;

describe("ComposerBar group preview", () => {
  beforeEach(() => {
    prepareSingleAttachmentMock.mockReset();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:attachment-preview"),
      revokeObjectURL: vi.fn(),
    });
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("keeps image attachments borderless, shows a spinner, and preserves text input", async () => {
    let finishPreparation!: (item: PreparedAttachmentItem) => void;
    prepareSingleAttachmentMock.mockImplementation(() => new Promise((resolve) => {
      finishPreparation = resolve;
    }));
    const { container } = render(
      <ChatWebSocketProvider value={connectedApi}>
        <ComposerBar onSend={noop} onNewChat={noop} onFileClick={noop} />
      </ChatWebSocketProvider>,
    );

    const editor = screen.getByRole("textbox");
    fireEvent.click(screen.getByLabelText("Upload image or file"));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const image = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [image] } });

    expect(screen.getByRole("status", { name: "Preparing photo.png" })).toBeVisible();
    expect(container.querySelector(".pi-composer-attachment--image")).toBeInTheDocument();
    expect(screen.queryByText("Pictures")).not.toBeInTheDocument();
    expect(editor).toHaveAttribute("contenteditable", "plaintext-only");

    fireEvent.click(container.querySelector(".pi-composer-attachment--image")!);
    expect(editor).toHaveFocus();
    editor.textContent = "图片说明";
    fireEvent.input(editor, { inputType: "insertText" });
    expect(editor).toHaveTextContent("图片说明");

    await act(async () => {
      finishPreparation({
        fileName: "Pictures/photo.png",
        textAppend: '<file name="Pictures/photo.png"></file>\n',
        image: { mediaType: "image/png", data: "abc" },
      });
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Preparing photo.png" })).not.toBeInTheDocument());
    expect(editor).toHaveTextContent("图片说明");
    expect(editor).toHaveFocus();
  });

  it("prepares an image while connecting and sends its typed caption after reconnect", async () => {
    let finishPreparation!: (item: PreparedAttachmentItem) => void;
    prepareSingleAttachmentMock.mockImplementation(() => new Promise((resolve) => {
      finishPreparation = resolve;
    }));
    const onSend = vi.fn(() => true);
    const renderComposer = (api: ChatWebSocketApi) => (
      <ChatWebSocketProvider value={api}>
        <ComposerBar sendDisabled={api.connectionState !== "connected"} onSend={onSend} onNewChat={noop} onFileClick={noop} />
      </ChatWebSocketProvider>
    );
    const { container, rerender } = render(renderComposer(connectingApi));

    const attachButton = screen.getByLabelText("Upload image or file");
    expect(attachButton).toBeEnabled();
    fireEvent.click(attachButton);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: { files: [new File(["image"], "connecting.png", { type: "image/png" })] },
    });

    const editor = screen.getByRole("textbox");
    editor.textContent = "连接完成后也要保留这段文字";
    fireEvent.input(editor, { inputType: "insertText" });
    await act(async () => {
      finishPreparation({
        fileName: "Pictures/connecting.png",
        textAppend: '<file name="Pictures/connecting.png"></file>\n',
        image: { mediaType: "image/png", data: "abc" },
      });
    });

    rerender(renderComposer(connectedApi));
    expect(editor).toHaveTextContent("连接完成后也要保留这段文字");
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(onSend).toHaveBeenCalledWith(
      '连接完成后也要保留这段文字\n\n<file name="Pictures/connecting.png"></file>',
      [{ mediaType: "image/png", data: "abc" }],
      "连接完成后也要保留这段文字",
    );
  });

  it("keeps the image and caption draft when transport rejects the send", async () => {
    prepareSingleAttachmentMock.mockResolvedValue({
      fileName: "Pictures/retry.png",
      textAppend: '<file name="Pictures/retry.png"></file>\n',
      image: { mediaType: "image/png", data: "abc" },
    });
    const onSend = vi.fn(() => false);
    const { container } = render(
      <ChatWebSocketProvider value={connectedApi}>
        <ComposerBar onSend={onSend} onNewChat={noop} onFileClick={noop} />
      </ChatWebSocketProvider>,
    );

    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(["image"], "retry.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Preparing retry.png" })).not.toBeInTheDocument());
    const editor = screen.getByRole("textbox");
    editor.textContent = "发送失败时不能清空";
    fireEvent.input(editor, { inputType: "insertText" });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(onSend).toHaveBeenCalledOnce();
    expect(editor).toHaveTextContent("发送失败时不能清空");
    expect(container.querySelector(".pi-composer-attachment--image")).toBeInTheDocument();
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
