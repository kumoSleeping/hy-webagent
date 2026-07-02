import fs from "node:fs/promises";
import path from "node:path";

const FILE_TAG_RE = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;

export interface ChatAttachmentImage {
  mediaType: string;
  data: string;
}

function isImageFileTag(body: string): boolean {
  const trimmed = body.trim();
  return !trimmed || trimmed.startsWith("[Image");
}

/** Image `<file name="…">` names in prompt order (skips inline text-file tags). */
export function imageNamesFromPrompt(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(FILE_TAG_RE)) {
    if (isImageFileTag(match[2] ?? "")) {
      names.push(match[1]);
    }
  }
  return names;
}

function safeBasename(name: string, index: number): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  if (base && base !== "." && base !== "..") return base;
  return `attachment-${index + 1}.jpg`;
}

function extensionForMediaType(mediaType: string): string {
  const sub = mediaType.split("/")[1]?.toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub && /^[a-z0-9+.-]+$/.test(sub)) return sub;
  return "jpg";
}

/**
 * Persist chat vision attachments under agent cwd (`projects/`) so tools like
 * `describe_image` can read them when the active model has no vision input.
 */
export async function persistChatAttachments(
  agentCwd: string,
  promptText: string,
  images: ChatAttachmentImage[]
): Promise<void> {
  if (!images.length) return;

  await fs.mkdir(agentCwd, { recursive: true });
  const names = imageNamesFromPrompt(promptText);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let fileName = safeBasename(names[i] ?? "", i);
    if (!path.extname(fileName)) {
      fileName = `${fileName}.${extensionForMediaType(img.mediaType)}`;
    }
    const outPath = path.join(agentCwd, fileName);
    await fs.writeFile(outPath, Buffer.from(img.data, "base64"));
  }
}
