import { useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useChatStore, type ChatStoreApi } from "../../stores/chatStore";
import { useAutoScrollFollow } from "../../hooks/useAutoScrollFollow";
import { useComposerReserveHeight } from "../../hooks/useComposerReserveHeight";
import { groupMessagesForFeed } from "../../lib/messageGrouping";
import { MessageBubble } from "./MessageBubble";

interface MessageFeedProps {
  /** v2 多会话:会话小窗传入自己的 store;缺省 = 激活会话单例。 */
  chatStore?: ChatStoreApi;
  /** 主聊天区要给 composer 悬浮高度留白;小窗里不需要。 */
  reserveComposer?: boolean;
}

export function MessageFeed({ chatStore, reserveComposer = true }: MessageFeedProps) {
  const api: ChatStoreApi = chatStore ?? useChatStore;
  const messages = useStore(api, (s) => s.messages);
  const isStreaming = useStore(api, (s) => s.isStreaming);
  const hydratedPiSessionId = useStore(api, (s) => s.hydratedPiSessionId);
  const { scrollRef, contentRef, scrollToBottom, handleScroll } = useAutoScrollFollow({
    resetKey: hydratedPiSessionId,
  });

  const composerReserve = useComposerReserveHeight([messages, isStreaming]);
  const bottomPad = reserveComposer ? `${composerReserve}px` : "0.75rem";
  const feedItems = useMemo(() => groupMessagesForFeed(messages), [messages]);
  const lastUserFeedIndex = useMemo(() => {
    for (let index = feedItems.length - 1; index >= 0; index -= 1) {
      if (feedItems[index]?.kind === "user") return index;
    }
    return -1;
  }, [feedItems]);

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
      style={{ paddingTop: "var(--pi-top-strip)", paddingBottom: bottomPad }}
    >
      <div ref={contentRef} className="mx-auto max-w-[var(--pi-feed-max)] pt-4 pb-0">
        {feedItems.map((item, index) =>
          item.kind === "user" ? (
            <MessageBubble key={item.key} messages={[item.message]} />
          ) : (
            <MessageBubble
              key={item.key}
              messages={item.messages}
              agentRunning={isStreaming && index > lastUserFeedIndex}
            />
          )
        )}
      </div>
    </div>
  );
}
