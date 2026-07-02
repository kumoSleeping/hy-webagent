import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage } from "../../types";
import { GlassPanel } from "../common/GlassPanel";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";
import { ToolGroupCard } from "./ToolGroupCard";
import { groupBlocksForDisplay } from "../../lib/blockGrouping";
import { markdownComponents } from "./markdownComponents";

interface MessageBubbleProps {
  message: ChatMessage;
}

function TextBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="pi-markdown">
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

function MessageImages({ images }: { images: NonNullable<ChatMessage["images"]> }) {
  return (
    <div className="pi-message-images">
      {images.map((img, index) => (
        <img
          key={`${img.mediaType}-${index}`}
          src={`data:${img.mediaType};base64,${img.data}`}
          alt={img.name ?? "Attached image"}
          className="pi-message-image"
        />
      ))}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const variant = isUser ? "message-user" : "message-assistant";
  const blocks = message.blocks;
  const isStreaming = !!message.isStreaming;

  // Same derivation regardless of whether this message is live-streaming
  // right now or was just replayed from history — grouping/collapsing is
  // always recomputed from the raw blocks, never a one-off side effect.
  const units = useMemo(() => groupBlocksForDisplay(blocks ?? [], isStreaming), [blocks, isStreaming]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-6`}>
      <GlassPanel variant={variant} className="min-w-0">
        {message.images && message.images.length > 0 && (
          <MessageImages images={message.images} />
        )}
        {units.length > 0
          ? units.map((u) => {
              switch (u.kind) {
                case "text":
                  return <TextBlock key={u.key} text={u.text} />;
                case "thinking":
                  return <ThinkingBlock key={u.key} content={u.text} isActive={u.isActive} />;
                case "tool":
                  return <ToolCallCard key={u.key} toolCall={u.tool} />;
                case "activity":
                  return <ToolGroupCard key={u.key} items={u.items} toolCount={u.toolCount} category={u.category} />;
              }
            })
          : message.content ? (
            /* fallback for messages without blocks */
            <TextBlock text={message.content} />
          ) : null}

        {/* Legacy tool calls (only shown if no blocks) */}
        {!blocks && message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.toolCallId} toolCall={tc} />
        ))}
      </GlassPanel>
    </div>
  );
}
