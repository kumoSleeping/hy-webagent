import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Plus, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useShallow } from "zustand/react/shallow";
import { useImeComposition } from "../../hooks/useImeComposition";
import { useAutoScrollFollow } from "../../hooks/useAutoScrollFollow";
import { markdownComponents } from "../chat/markdownComponents";
import { useBtwStore } from "../../stores/btwStore";

interface BtwPanelProps {
  disabled?: boolean;
  onAsk: (question: string) => void;
  onNew: () => void;
}

function MarkdownAnswer({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text.trim()) return null;
  return (
    <div className={`pi-markdown pi-btw-answer${streaming ? " pi-btw-answer--streaming-md" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function BtwTurns() {
  const turns = useBtwStore(useShallow((s) => s.turns));
  const pendingTurnId = turns.find((t) => t.pending)?.id ?? null;
  const { scrollRef, contentRef, scrollToBottom, handleScroll } = useAutoScrollFollow({
    resetKey: pendingTurnId,
  });

  useLayoutEffect(() => {
    scrollToBottom();
  }, [turns, scrollToBottom]);

  if (turns.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto pi-scrollbar px-3 pt-2 pb-2 pi-btw-turns"
    >
      <div ref={contentRef}>
        {turns.map((turn) => (
          <div key={turn.id} className="pi-btw-turn">
            {turn.question && (
              <div className="pi-btw-question">
                <span className="pi-btw-label">Q</span>
                <span>{turn.question}</span>
              </div>
            )}
            {!turn.error && !turn.answer && (
              <div className="pi-btw-pending" aria-live="polite">
                <span className="pi-btw-label">A</span>
                <span className="pi-btw-dots">…</span>
              </div>
            )}
            {turn.error && (
              <div className="pi-btw-error">
                <span className="pi-btw-label">!</span>
                <span>{turn.error}</span>
              </div>
            )}
            {turn.answer && (
              <div className="pi-btw-answer-wrap">
                <span className="pi-btw-label">A</span>
                <MarkdownAnswer text={turn.answer} streaming={turn.pending} />
                {turn.pending && <span className="pi-btw-dots pi-btw-stream-cursor">…</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BtwInput({
  disabled,
  onAsk,
  onNew,
  newDisabled,
}: {
  disabled?: boolean;
  onAsk: (question: string) => void;
  onNew: () => void;
  newDisabled?: boolean;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { imeProps, isComposing } = useImeComposition((value) => {
    setText(value);
  });

  function submit() {
    const q = text.trim();
    if (!q || disabled) return;
    // Optimistic Q + waiting A before the websocket round-trip.
    useBtwStore.getState().ensureTurn(q);
    onAsk(q);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      if (isComposing(e)) return;
      e.preventDefault();
      submit();
    }
  }

  function handleNewClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (newDisabled) return;
    onNew();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="pi-btw-input-row" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="pi-btw-new-btn"
        disabled={newDisabled}
        onClick={handleNewClick}
        title="New side thread"
        aria-label="New side thread"
      >
        <Plus strokeWidth={2} />
      </button>
      <textarea
        ref={inputRef}
        rows={1}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        enterKeyHint="send"
        placeholder="By the Way..."
        spellCheck={false}
        className="pi-btw-input"
        {...imeProps}
      />
      <button
        type="button"
        className="pi-btw-send"
        disabled={disabled || !text.trim()}
        onClick={(e) => {
          e.stopPropagation();
          submit();
        }}
        aria-label="Ask"
      >
        <Send strokeWidth={2} />
      </button>
    </div>
  );
}

/** /btw side Q&A — compact panel in composer toolbar. */
export function BtwPanel({ disabled, onAsk, onNew }: BtwPanelProps) {
  const turns = useBtwStore(useShallow((s) => s.turns));
  const isPending = turns.some((t) => t.pending);
  const hasTurns = turns.length > 0;

  return (
    <div className={`pi-btw-panel pi-btw-panel--compact${hasTurns ? " pi-btw-panel--compact-history" : ""}`}>
      {hasTurns && <BtwTurns />}
      <BtwInput
        disabled={disabled || isPending}
        onAsk={onAsk}
        onNew={onNew}
        newDisabled={disabled || isPending}
      />
    </div>
  );
}

export function hasBtwContent(): boolean {
  return useBtwStore.getState().turns.length > 0;
}
