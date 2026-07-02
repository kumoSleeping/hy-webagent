/** PI session history stores `<file name="...">…</file>` markers for attachments. */
const FILE_ATTACHMENT_TAG_RE = /<file name="[^"]*">[\s\S]*?<\/file>\n?/g;

export function stripFileAttachmentTags(text: string): string {
  return text.replace(FILE_ATTACHMENT_TAG_RE, "").trim();
}

export function fileNameFromAttachmentTags(text: string): string | undefined {
  const match = text.match(/<file name="([^"]+)">/);
  return match?.[1];
}

/** Human-readable preview for session titles and list rows. */
export function formatUserMessagePreview(text: string): string {
  const stripped = stripFileAttachmentTags(text);
  if (stripped) return stripped;

  const fileName = fileNameFromAttachmentTags(text);
  if (fileName) {
    const base = fileName.split(/[/\\]/).pop();
    return base || fileName;
  }

  return text.trim();
}

export function titleFromUserMessage(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") {
    return formatUserMessagePreview(content);
  }
  if (!Array.isArray(content)) return "";

  let text = "";
  let hasImage = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") text += p.text;
    if (p.type === "image") hasImage = true;
  }

  const preview = formatUserMessagePreview(text);
  if (preview) return preview;
  if (hasImage) return "Image attachment";
  return "";
}
