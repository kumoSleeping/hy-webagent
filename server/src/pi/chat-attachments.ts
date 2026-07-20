import fs from "node:fs/promises";
import path from "node:path";

const FILE_TAG_RE = /<file name="([^"]+)">([\s\S]*?)<\/file>/g;

/** Chat image uploads land under `{agentCwd}/Pictures/`. */
export const CHAT_PICTURES_DIR = "Pictures";

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

/** Resolve a prompt file name into a path under `Pictures/` (relative to agent cwd). */
export function resolveChatPictureRelPath(name: string, index: number): string {
  const raw = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const underPictures = raw.startsWith(`${CHAT_PICTURES_DIR}/`)
    ? raw.slice(CHAT_PICTURES_DIR.length + 1)
    : raw;
  let fileName = safeBasename(underPictures || name, index);
  if (!path.extname(fileName)) {
    fileName = `${fileName}.bin`;
  }
  return path.posix.join(CHAT_PICTURES_DIR, fileName);
}

async function uniquePath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let candidate = path.join(dir, fileName);
  let n = 2;
  for (;;) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${stem}-${n}${ext}`);
      n += 1;
    } catch {
      return candidate;
    }
  }
}

/**
 * Persist chat vision attachments under `projects/Pictures/` so they show up
 * in the Files panel and tools like `describe_image` can read them.
 */
export async function persistChatAttachments(
  agentCwd: string,
  promptText: string,
  images: ChatAttachmentImage[]
): Promise<void> {
  if (!images.length) return;

  const picturesDir = path.join(agentCwd, CHAT_PICTURES_DIR);
  await fs.mkdir(picturesDir, { recursive: true });
  const names = imageNamesFromPrompt(promptText);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let rel = resolveChatPictureRelPath(names[i] ?? "", i);
    if (!path.extname(path.basename(rel))) {
      rel = `${rel}.${extensionForMediaType(img.mediaType)}`;
    }
    const fileName = path.basename(rel);
    const outPath = await uniquePath(picturesDir, fileName);
    await fs.writeFile(outPath, Buffer.from(img.data, "base64"));
  }
}
