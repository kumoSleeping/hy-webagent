/**
 * 多会话小窗内嵌输入 —— 有窗时底栏输入收起,每扇窗底部自带一行。
 * 点进输入区即激活该会话;回车盖章路由与主输入同一套 handleSend/onSteer。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { Send } from "lucide-react";
import { StableComposerEditor, type ComposerEditorHandle } from "./StableComposerEditor";
import { useImeComposition } from "../../hooks/useImeComposition";
import { useChatStore } from "../../stores/chatStore";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import { useConnectionState } from "../../context/useChatConnection";

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

  const [text, setText] = useState("");
  const taRef = useRef<ComposerEditorHandle>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const { isComposing, imeProps } = useImeComposition<HTMLDivElement>();

  const activate = useCallback(() => {
    useSessionWindowsStore.getState().bringToFront(sessionId);
    if (useSessionStore.getState().activePiSessionId !== sessionId) {
      useSessionStore.getState().setActiveSession(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isActive) return;
    // 切到本窗时把焦点放进窗内输入(底栏已隐藏)。
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isActive]);

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

  const canSend = !disabled && !sendUnavailable && text.trim().length > 0;

  return (
    <div
      className="pi-swin-composer"
      onPointerDownCapture={activate}
      onClick={(e) => e.stopPropagation()}
    >
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
  );
}
