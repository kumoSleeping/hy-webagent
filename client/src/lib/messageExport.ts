import type { ChatMessage } from "../types";

export function messageExportText(message: ChatMessage): string {
  const blockText = message.blocks
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return blockText || message.content.trim();
}

export async function renderMessageImage(markdown: string): Promise<{ dataUri: string; mimeType: string }> {
  const response = await fetch("/api/public/render/b64", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, theme_color: "#ef4444" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.data !== "string") {
    throw new Error(body.error || body.detail || `HTTP ${response.status}`);
  }
  return { dataUri: body.data, mimeType: typeof body.mime_type === "string" ? body.mime_type : "image/jpeg" };
}

export function downloadDataUri(dataUri: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUri;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function messageImageFilename(message: ChatMessage, mimeType: string): string {
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const stamp = new Date(message.timestamp || Date.now()).toISOString().replace(/[:.]/g, "-");
  return `pi-${message.role}-${stamp}.${extension}`;
}
