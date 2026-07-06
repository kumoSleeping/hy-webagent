import type { ChatImageAttachment, ChatMessage } from "../types";
import {
  fileNameFromAttachmentTags,
  parseHistoryImagePart,
  stripFileAttachmentTags,
} from "./prepareAttachments";

/** Convert a Pi SDK user message payload into a client ChatMessage. */
export function convertSdkUserMessage(raw: any, fallbackId: () => string): ChatMessage | null {
  if (!raw || raw.role !== "user") return null;

  let content = "";
  let rawTextForTags = "";
  const images: ChatImageAttachment[] = [];

  if (Array.isArray(raw.content)) {
    for (const p of raw.content) {
      if (p.type === "text") {
        content += p.text;
        rawTextForTags += p.text;
      } else if (p.type === "image") {
        const parsed = parseHistoryImagePart(p);
        if (parsed) images.push({ mediaType: parsed.mediaType, data: parsed.data });
      }
    }
  } else if (typeof raw.content === "string") {
    content = raw.content;
    rawTextForTags = raw.content;
  }

  content = stripFileAttachmentTags(content);
  if (!content.trim() && images.length === 0) return null;

  if (images.length > 0) {
    const name = fileNameFromAttachmentTags(rawTextForTags);
    if (name) {
      for (const img of images) img.name = name;
    }
  }

  return {
    id: String(raw.id || fallbackId()),
    role: "user",
    content,
    timestamp: raw.timestamp || Date.now(),
    images: images.length > 0 ? images : undefined,
  };
}
