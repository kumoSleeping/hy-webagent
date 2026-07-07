import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface ThinkingBlockProps {
  content: string;
  /** True while this is the agent's current thinking segment (last block, message still streaming). */
  isActive: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, isActive }: ThinkingBlockProps) {
  // `null` = no manual override yet, follow `isActive` (open while thinking
  // is live, closes once the agent moves on to a tool call/text). Once the
  // user toggles it, their choice sticks — they always have the final say.
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const expanded = manualExpanded ?? isActive;

  // While the agent is actively thinking, keep the capped scroll area pinned
  // to the bottom so new tokens stay visible without manual scrolling.
  useEffect(() => {
    if (!content || !isActive || !expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    scrollToBottom();
    const ro = new ResizeObserver(scrollToBottom);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content, isActive, expanded]);

  if (!content) {
    if (!isActive) return null;
    // Agent turn has started but nothing is visible yet — still thinking.
    return (
      <div className="pi-thinking-block">
        <div className="flex items-center gap-1.5 py-1 text-xs text-[var(--pi-muted)]">
          <Loader2 size={14} className="animate-spin" />
          <span>Thinking</span>
          <span className="pi-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pi-thinking-block">
      <button
        onClick={() => setManualExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 text-xs text-[var(--pi-muted)] hover:text-[var(--pi-text)] transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{isActive ? "Thinking..." : "Thought process"}</span>
      </button>
      {expanded && (
        <div
          ref={bodyRef}
          className="mt-3 pl-1 text-xs text-[var(--pi-muted)] whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-auto pi-scrollbar"
        >
          {content}
        </div>
      )}
    </div>
  );
});
