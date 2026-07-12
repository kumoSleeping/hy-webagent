import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clipboard, ImageDown, LoaderCircle } from "lucide-react";
import type { ChatMessage } from "../../types";
import { GlassPanel } from "../common/GlassPanel";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";
import { ToolGroupCard } from "./ToolGroupCard";
import { groupBlocksForDisplay } from "../../lib/blockGrouping";
import { MarkdownContent } from "./MarkdownContent";
import { splitTextWithMarkers } from "../../lib/compressedText";
import { useAuthStore } from "../../stores/authStore";
import { copyTextToClipboard } from "../../lib/copyToClipboard";
import { downloadDataUri, messageExportText, messageImageFilename, renderMessageImage } from "../../lib/messageExport";
import { useNotificationStore } from "../../stores/notificationStore";

interface MessageBubbleProps {
  message: ChatMessage;
}

function UserTextBlock({ text }: { text: string }) {
  const parts = useMemo(() => splitTextWithMarkers(text), [text]);
  return (
    <div className="pi-user-text">
      {parts.map((part, index) =>
        part.kind === "marker" ? (
          <span key={index} className="pi-compressed-marker">{part.value}</span>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </div>
  );
}

function TextBlock({ text, isUser }: { text: string; isUser?: boolean }) {
  if (!text) return null;
  if (isUser) {
    return <UserTextBlock text={text} />;
  }
  return <MarkdownContent>{text}</MarkdownContent>;
}

const MessageImages = memo(function MessageImages({ images }: { images: NonNullable<ChatMessage["images"]> }) {
  return (
    <div className="pi-message-images">
      {images.map((img, index) => (
        <img
          key={`${img.mediaType}-${index}`}
          src={`data:${img.mediaType};base64,${img.data}`}
          alt={img.name ?? "Attached image"}
          className="pi-message-image"
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
});

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const variant = isUser ? "message-user" : "message-assistant";
  const blocks = message.blocks;
  const isStreaming = !!message.isStreaming;
  const isPreviewMode = useAuthStore(s => s.isPreviewMode);
  const notify = useNotificationStore(s => s.notify);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const exportText = useMemo(() => messageExportText(message), [message]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== message.id) close();
    };
    document.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("pi-message-menu-open", closeOther);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pi-message-menu-open", closeOther);
    };
  }, [menu, message.id]);

  function openMenu(event: React.MouseEvent) {
    if (!exportText) return;
    event.preventDefault();
    const width = 176;
    const height = 92;
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - width - 8),
      y: Math.min(event.clientY, window.innerHeight - height - 8),
    });
    window.dispatchEvent(new CustomEvent("pi-message-menu-open", { detail: message.id }));
  }

  async function copyMessage() {
    setMenu(null);
    const copied = await copyTextToClipboard(exportText);
    notify(copied ? "消息已复制" : "复制失败，请检查浏览器权限", copied ? "success" : "info");
  }

  async function saveMessageImage() {
    setMenu(null);
    setRendering(true);
    try {
      const image = await renderMessageImage(exportText);
      downloadDataUri(image.dataUri, messageImageFilename(message, image.mimeType));
      notify("图片已生成，下载已开始", "success");
    } catch (error) {
      notify(`图片生成失败：${error instanceof Error ? error.message : "未知错误"}`, "info");
    } finally {
      setRendering(false);
    }
  }

  // Same derivation regardless of whether this message is live-streaming
  // right now or was just replayed from history — grouping/collapsing is
  // always recomputed from the raw blocks, never a one-off side effect.
  const units = useMemo(() => groupBlocksForDisplay(blocks ?? [], isStreaming), [blocks, isStreaming]);
  const visibleUnits = useMemo(
    () => isPreviewMode ? units.filter((unit) => unit.kind !== "thinking") : units,
    [isPreviewMode, units],
  );

  const hasLegacyTools = !blocks && (message.toolCalls?.length ?? 0) > 0;
  const hasImages = (message.images?.length ?? 0) > 0;
  const hasVisibleContent =
    hasImages ||
    hasLegacyTools ||
    visibleUnits.length > 0 ||
    Boolean(message.content?.trim());

  if (!isUser && !isStreaming && !hasVisibleContent) return null;

  return (
    <div className={`pi-message-bubble flex ${isUser ? "justify-end" : "justify-start"} mb-4`} onContextMenu={openMenu}>
      <GlassPanel variant={variant} className="min-w-0">
        {message.images && message.images.length > 0 && (
          <MessageImages images={message.images} />
        )}
        {visibleUnits.length > 0
          ? visibleUnits.map((u) => {
              switch (u.kind) {
                case "text":
                  return <TextBlock key={u.key} text={u.text} isUser={isUser} />;
                case "thinking":
                  if (isPreviewMode) return null;
                  return <ThinkingBlock key={u.key} content={u.text} isActive={u.isActive} />;
                case "tool":
                  return <ToolCallCard key={u.key} toolCall={u.tool} />;
                case "activity":
                  return <ToolGroupCard key={u.key} items={u.items} toolCount={u.toolCount} category={u.category} />;
              }
            })
          : message.content ? (
            /* fallback for messages without blocks */
            <TextBlock text={message.content} isUser={isUser} />
          ) : null}

        {/* Legacy tool calls (only shown if no blocks) */}
        {!blocks && message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.toolCallId} toolCall={tc} />
        ))}
      </GlassPanel>
      {rendering && <span className="pi-message-exporting" title="正在生成图片"><LoaderCircle size={15} /></span>}
      {menu && createPortal(
        <div className="pi-message-context-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => void copyMessage()}><Clipboard size={15} /><span>复制内容</span></button>
          <button type="button" role="menuitem" onClick={() => void saveMessageImage()}><ImageDown size={15} /><span>保存为图片</span></button>
        </div>,
        document.body
      )}
    </div>
  );
}, (prev, next) => prev.message === next.message);
