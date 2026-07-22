import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clipboard, ImageDown, LoaderCircle } from "lucide-react";
import type { ChatMessage } from "../../types";
import { GlassPanel } from "../common/GlassPanel";
import { ProcessTrace } from "./ProcessTrace";
import { MarkdownContent } from "./MarkdownContent";
import { splitTextWithMarkers } from "../../lib/compressedText";
import { useAuthStore } from "../../stores/authStore";
import { copyTextToClipboard } from "../../lib/copyToClipboard";
import { downloadDataUri, messageExportText, messageImageFilename, renderMessageImage } from "../../lib/messageExport";
import { buildAssistantTurnView } from "../../lib/messageGrouping";
import { useNotificationStore } from "../../stores/notificationStore";

interface MessageBubbleProps {
  /** One user message, or consecutive assistant messages coalesced into one turn. */
  messages: ChatMessage[];
  /** Whole agent loop is running, including gaps between assistant messages. */
  agentRunning?: boolean;
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

function SkillInvocationChip({ name }: { name: string }) {
  return <span className="pi-skill-invocation-chip">[skill] {name}</span>;
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

export const MessageBubble = memo(function MessageBubble({ messages, agentRunning = false }: MessageBubbleProps) {
  const primary = messages[0];
  if (!primary) return null;

  const isUser = primary.role === "user";
  if (isUser) {
    return <UserBubble message={primary} />;
  }
  return <AssistantTurnBubble messages={messages} agentRunning={agentRunning} />;
}, (prev, next) => {
  if (prev.agentRunning !== next.agentRunning) return false;
  if (prev.messages.length !== next.messages.length) return false;
  return prev.messages.every((m, i) => m === next.messages[i]);
});

function UserBubble({ message }: { message: ChatMessage }) {
  const notify = useNotificationStore(s => s.notify);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const exportText = useMemo(() => messageExportText(message), [message]);

  useMessageMenu(menu, message.id, setMenu);

  if (!message.content?.trim() && !(message.images?.length) && !message.skillInvocation) return null;

  return (
    <div
      className="pi-message-bubble flex justify-end mb-4"
      onContextMenu={(event) => openMenu(event, exportText, message.id, setMenu)}
    >
      <GlassPanel variant="message-user" className="min-w-0">
        {message.images && message.images.length > 0 && <MessageImages images={message.images} />}
        {message.skillInvocation && <SkillInvocationChip name={message.skillInvocation.name} />}
        {message.content ? <TextBlock text={message.content} isUser /> : null}
      </GlassPanel>
      {rendering && <span className="pi-message-exporting" title="正在生成图片"><LoaderCircle size={15} /></span>}
      {menu && (
        <MessageMenu
          x={menu.x}
          y={menu.y}
          onCopy={() => void copyExport(exportText, notify, setMenu)}
          onSave={() => void saveExport(exportText, message, notify, setMenu, setRendering)}
        />
      )}
    </div>
  );
}

function AssistantTurnBubble({ messages, agentRunning }: { messages: ChatMessage[]; agentRunning: boolean }) {
  const isPreviewMode = useAuthStore(s => s.isPreviewMode);
  const notify = useNotificationStore(s => s.notify);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  const turn = useMemo(() => buildAssistantTurnView(messages, agentRunning), [messages, agentRunning]);
  const exportText = useMemo(() => {
    const parts = [
      ...turn.texts.map((t) => t.text.trim()).filter(Boolean),
      ...turn.errors,
    ];
    if (parts.length > 0) return parts.join("\n\n");
    return messageExportText(turn.exportMessage);
  }, [turn]);

  useMessageMenu(menu, turn.exportMessage.id, setMenu);

  const hasVisibleContent =
    turn.images.length > 0 ||
    turn.items.length > 0 ||
    turn.texts.length > 0 ||
    turn.errors.length > 0 ||
    turn.isStreaming;

  if (!hasVisibleContent) return null;

  return (
    <div
      className={`pi-message-bubble flex justify-start mb-4${agentRunning ? " pi-message-bubble--live" : ""}`}
      onContextMenu={(event) => openMenu(event, exportText, turn.exportMessage.id, setMenu)}
    >
      <GlassPanel variant="message-assistant" className="min-w-0">
        {turn.images.length > 0 && <MessageImages images={turn.images} />}
        {(turn.items.length > 0 || turn.processActive) && (
          <ProcessTrace
            items={turn.items}
            isActive={turn.processActive}
            activeIndex={turn.activeIndex}
            durationMs={turn.durationMs}
            hideThinking={isPreviewMode}
          />
        )}
        {turn.texts.map((t) => (
          <TextBlock key={t.key} text={t.text} />
        ))}
        {turn.errors.map((error, index) => (
          <div key={`error-${index}`} className="pi-message-error" role="alert">
            {error}
          </div>
        ))}
      </GlassPanel>
      {rendering && <span className="pi-message-exporting" title="正在生成图片"><LoaderCircle size={15} /></span>}
      {menu && (
        <MessageMenu
          x={menu.x}
          y={menu.y}
          onCopy={() => void copyExport(exportText, notify, setMenu)}
          onSave={() => void saveExport(exportText, turn.exportMessage, notify, setMenu, setRendering)}
        />
      )}
    </div>
  );
}

function useMessageMenu(
  menu: { x: number; y: number } | null,
  messageId: string,
  setMenu: (v: { x: number; y: number } | null) => void,
) {
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== messageId) close();
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
  }, [menu, messageId, setMenu]);
}

function openMenu(
  event: React.MouseEvent,
  exportText: string,
  messageId: string,
  setMenu: (v: { x: number; y: number } | null) => void,
) {
  if (!exportText) return;
  event.preventDefault();
  const width = 176;
  const height = 92;
  setMenu({
    x: Math.min(event.clientX, window.innerWidth - width - 8),
    y: Math.min(event.clientY, window.innerHeight - height - 8),
  });
  window.dispatchEvent(new CustomEvent("pi-message-menu-open", { detail: messageId }));
}

async function copyExport(
  exportText: string,
  notify: (msg: string, kind: "success" | "info") => void,
  setMenu: (v: { x: number; y: number } | null) => void,
) {
  setMenu(null);
  const copied = await copyTextToClipboard(exportText);
  notify(copied ? "消息已复制" : "复制失败，请检查浏览器权限", copied ? "success" : "info");
}

async function saveExport(
  exportText: string,
  message: ChatMessage,
  notify: (msg: string, kind: "success" | "info") => void,
  setMenu: (v: { x: number; y: number } | null) => void,
  setRendering: (v: boolean) => void,
) {
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

function MessageMenu({
  x,
  y,
  onCopy,
  onSave,
}: {
  x: number;
  y: number;
  onCopy: () => void;
  onSave: () => void;
}) {
  return createPortal(
    <div
      className="pi-message-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onCopy}>
        <Clipboard size={15} />
        <span>复制内容</span>
      </button>
      <button type="button" role="menuitem" onClick={onSave}>
        <ImageDown size={15} />
        <span>保存为图片</span>
      </button>
    </div>,
    document.body,
  );
}
