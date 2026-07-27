/**
 * 多会话小窗内嵌对话框 —— 外形与主输入壳一致(白卡 + 描边 + 阴影),
 * 顶栏精简为「命令 / 新建」,输入行在下方。点进即激活该会话。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { AppWindow, Command, Send } from "lucide-react";
import { StableComposerEditor, type ComposerEditorHandle } from "./StableComposerEditor";
import { useImeComposition } from "../../hooks/useImeComposition";
import { useChatStore } from "../../stores/chatStore";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { seedSpawnRect, useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useSlashStore } from "../../stores/slashStore";
import { useConnectionState } from "../../context/useChatConnection";
import { toolbarBtnWidthPx, MOBILE_TOOLBAR_BTN_MAX_PX } from "../../lib/composerLayout";

interface SessionWindowComposerProps {
  sessionId: string;
  disabled?: boolean;
  onSend: (text: string) => boolean | void;
  onSteer?: (text: string) => void;
  onAbort?: () => void;
}

export function SessionWindowComposer({
  sessionId,
  disabled = false,
  onSend,
  onSteer,
  onAbort,
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
    // 新窗刚挂载时 editor 可能晚一帧就绪 —— 双 rAF 更稳。
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

  function handleCommandsClick(e: React.MouseEvent) {
    e.stopPropagation();
    activate();
    useSlashStore.getState().setActivePanel(null);
    const store = useComposerPanelStore.getState();
    store.setPanel(store.panel === "commands" ? null : "commands");
    useSessionWindowsStore.getState().raisePanel();
  }

  function handleNewChatClick(e: React.MouseEvent) {
    e.stopPropagation();
    void (async () => {
      const id = await useSessionStore.getState().createSession();
      if (!id) return;
      useSessionStore.getState().setActiveSession(id);
      seedSpawnRect(id);
      const ws = useSessionWindowsStore.getState();
      ws.open(id);
      ws.requestWindowComposerFocus(id);
      void useSessionStore.getState().fetchSessions();
    })();
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
            <button
              type="button"
              style={{ width: `${btnWidthPx}px`, flex: `0 0 ${btnWidthPx}px` }}
              className="pi-composer-toolbar-btn"
              data-active={isActive && panel === "commands"}
              onPointerDown={(e) => e.preventDefault()}
              onClick={handleCommandsClick}
              title="Commands"
              aria-label="Toggle commands"
            >
              <Command strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              style={{ width: `${btnWidthPx}px`, flex: `0 0 ${btnWidthPx}px` }}
              className="pi-composer-toolbar-btn pi-composer-toolbar-btn--accent"
              onPointerDown={(e) => e.preventDefault()}
              onClick={handleNewChatClick}
              title="新会话小窗"
              aria-label="新建会话并开小窗"
            >
              <AppWindow strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="pi-swin-composer-body">
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
            className="pi-composer-input pi-swin-composer-input min-w-0 flex-1 resize-none border-none bg-transparent px-1.5 py-1 text-[var(--pi-text)] outline-none disabled:cursor-not-allowed"
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
  );
}
