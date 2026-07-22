import { useLayoutEffect } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useAutoScrollFollow } from "../../hooks/useAutoScrollFollow";
import { useComposerReserveHeight } from "../../hooks/useComposerReserveHeight";
import { MessageBubble } from "./MessageBubble";

export function MessageFeed() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const hydratedPiSessionId = useChatStore((s) => s.hydratedPiSessionId);
  const { scrollRef, contentRef, scrollToBottom, handleScroll } = useAutoScrollFollow({
    resetKey: hydratedPiSessionId,
  });

  const composerReserve = useComposerReserveHeight([messages, isStreaming]);

  // Catch every streaming delta — ResizeObserver alone misses growth that
  // happens inside capped inner scroll areas (e.g. process-step body)
  // and can lag one frame behind rapid text updates.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming, composerReserve, scrollToBottom]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto pi-scrollbar px-[var(--pi-feed-edge)]"
      style={{ paddingTop: "var(--pi-top-strip)", paddingBottom: `${composerReserve}px` }}
    >
      <div ref={contentRef} className="mx-auto max-w-[var(--pi-feed-max)] py-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>
    </div>
  );
}
