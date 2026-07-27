/**
 * 多会话小窗内嵌对话框 —— 版式对齐主输入壳(.pi-composer-shell):
 * 留白 / 行高 / 顶栏贴合 / 输入行 gap 同一套刻度;顶栏功能精简但齐全。
 * 「新建」= 本窗换成新会话(不另开窗)。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import {
  Command,
  Cpu,
  FolderOpen,
  MessageSquarePlus,
  Send,
  X,
} from "lucide-react";
import { StableComposerEditor, type ComposerEditorHandle } from "./StableComposerEditor";
import { useImeComposition } from "../../hooks/useImeComposition";
import { useChatStore } from "../../stores/chatStore";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import { useComposerPanelStore, type ComposerPanelKind } from "../../stores/composerPanelStore";
import { useSlashStore } from "../../stores/slashStore";
import { useConnectionState } from "../../context/useChatConnection";
import { toolbarBtnWidthPx, MOBILE_TOOLBAR_BTN_MAX_PX } from "../../lib/composerLayout";

interface SessionWindowComposerProps {
  sessionId: string;
  disabled?: boolean;
  onSend: (text: string) => boolean | void;
  onSteer?: (text: string) => void;
  onAbort?: () => void;
  /** 关闭本小窗(会话仍在列表)。 */
  onClose?: () => void;
}

type WindowToolbarId = "commands" | "model" | "close" | "files" | "new-session";

const WINDOW_TOOLBAR: { id: WindowToolbarId; panel: Exclude<ComposerPanelKind, null> | null; title: string; aria: string }[] = [
  { id: "commands", panel: "commands", title: "Commands", aria: "Toggle commands" },
  { id: "model", panel: "model", title: "Model", aria: "Toggle model selector" },
  { id: "close", panel: null, title: "关闭小窗（会话保留在列表）", aria: "关闭小窗" },
  { id: "files", panel: "files", title: "Files", aria: "Toggle files" },
  { id: "new-session", panel: null, title: "新建会话（替换本窗）", aria: "新建会话并替换本窗" },
];

function toolbarIcon(id: WindowToolbarId) {
  switch (id) {
    case "commands":
      return <Command strokeWidth={2} aria-hidden="true" />;
    case "model":
      return <Cpu strokeWidth={2} aria-hidden="true" />;
    case "close":
      return <X strokeWidth={2} aria-hidden="true" />;
    case "files":
      return <FolderOpen strokeWidth={2} aria-hidden="true" />;
    case "new-session":
      return <MessageSquarePlus strokeWidth={2} aria-hidden="true" />;
  }
}

export function SessionWindowComposer({
  sessionId,
  disabled = false,
  onSend,
  onSteer,
  onAbort,
  onClose,
}: SessionWindowComposerProps) {
  const chatStore = ensureChatStore(sessionId);
  const activeId = useSessionStore((s) => s.activePiSessionId);
  const mainHydrated = useChatStore((s) => s.hydratedPiSessionId);
  const isActive = activeId === sessionId;
  const mirrorMain = isActive && mainHydrated === sessionId;
  const isStreaming = useStore(mirrorMain ? useChatStore : chatStore, (s) => s.isStreaming);
  const connectionState = useConnectionState();
  const sendUnavailable = connectionState !== "connected";
  const panel = useComposerPanelStore((s) => s.panel);
  const focusTick = useSessionWindowsStore((s) => s.focusTick);
  const focusSessionId = useSessionWindowsStore((s) => s.focusSessionId);

  const [text, setText] = useState("");
  const taRef = useRef<ComposerEditorHandle>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const { isComposing, imeProps } = useImeComposition<HTMLDivElement>();
  const btnWidthPx = Math.min(toolbarBtnWidthPx(), MOBILE_TOOLBAR_BTN_MAX_PX);

  const activate = useCallback(() => {
    useSessionWindowsStore.getState().bringToFront(sessionId);
    if (useSessionStore.getState().activePiSessionId !== sessionId) {
      useSessionStore.getState().setActiveSession(sessionId);
    }
  }, [sessionId]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isActive) return;
    focusInput();
  }, [isActive, focusInput]);

  useEffect(() => {
    if (focusSessionId !== sessionId || focusTick === 0) return;
    activate();
    requestAnimationFrame(() => requestAnimationFrame(() => taRef.current?.focus()));
  }, [focusTick, focusSessionId, sessionId, activate]);

  function submit() {
    const value = (taRef.current?.value ?? textRef.current).trim();
    if (!value || disabled || sendUnavailable) return;
    activate();
    if (isStreaming) {
      onSteer?.(value);
    } else {
      const accepted = onSend(value);
      if (accepted === false) return;
    }
    setText("");
    if (taRef.current) taRef.current.value = "";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.shiftKey || isComposing(e)) return;
    e.preventDefault();
    submit();
  }

  function openPanel(kind: Exclude<ComposerPanelKind, null>) {
    activate();
    useSlashStore.getState().setActivePanel(null);
    const store = useComposerPanelStore.getState();
    if (kind === "files") {
      store.toggleFilesPanel();
    } else {
      store.setPanel(store.panel === kind ? null : kind);
    }
    useSessionWindowsStore.getState().raisePanel();
  }

  function handleToolbarClick(id: WindowToolbarId, panelKind: Exclude<ComposerPanelKind, null> | null) {
    if (id === "close") {
      onClose?.();
      return;
    }
    if (id === "new-session") {
      void (async () => {
        const newId = await useSessionStore.getState().createSession();
        if (!newId) return;
        const ws = useSessionWindowsStore.getState();
        ws.replaceSession(sessionId, newId);
        useSessionStore.getState().setActiveSession(newId);
        ws.requestWindowComposerFocus(newId);
        void useSessionStore.getState().fetchSessions();
      })();
      return;
    }
    if (panelKind) openPanel(panelKind);
  }

  const canSend = !disabled && !sendUnavailable && text.trim().length > 0;

  return (
    <div
      className="pi-swin-composer-dock"
      onPointerDownCapture={activate}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pi-swin-composer-shell">
        <div className="pi-swin-composer-toolbar" onClick={(e) => e.stopPropagation()}>
          <div className="pi-composer-toolbar-bar">
            {WINDOW_TOOLBAR.map((item) => (
              <button
                key={item.id}
                type="button"
                style={{ width: `${btnWidthPx}px`, flex: `0 0 ${btnWidthPx}px` }}
                className={`pi-composer-toolbar-btn${item.id === "new-session" ? " pi-composer-toolbar-btn--accent" : ""}`}
                data-active={
                  item.panel != null && isActive && panel === item.panel ? true : false
                }
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToolbarClick(item.id, item.panel);
                }}
                title={item.title}
                aria-label={item.aria}
              >
                {toolbarIcon(item.id)}
              </button>
            ))}
          </div>
        </div>

        <div className="pi-composer-body">
          <div className="pi-composer-input-row">
            {isStreaming && (
              <button
                type="button"
                className="pi-composer-working pi-swin-composer-working"
                onClick={(e) => {
                  e.stopPropagation();
                  activate();
                  onAbort?.();
                }}
                title="Stop"
                aria-label="Stop — click to interrupt"
              >
                <span className="pi-composer-working-bars" aria-hidden="true">
                  <span /><span /><span /><span />
                </span>
              </button>
            )}
            <StableComposerEditor
              ref={taRef}
              initialValue={text}
              onValueChange={setText}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={disabled}
              placeholder=""
              onKeyDown={handleKeyDown}
              enterKeyHint="send"
              spellCheck={false}
              {...imeProps}
              className="pi-composer-input min-w-0 flex-1 resize-none border-none bg-transparent px-1.5 py-1.5 text-[var(--pi-text)] outline-none disabled:cursor-not-allowed"
            />
            <button
              type="button"
              className={`pi-composer-send-btn${canSend ? " pi-composer-send-btn--accent" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                submit();
              }}
              disabled={!canSend}
              title="Send message"
              aria-label="Send message"
            >
              <Send strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
