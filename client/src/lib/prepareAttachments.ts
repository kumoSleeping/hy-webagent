import { compressImageFile, formatDimensionNote } from "./compressImage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Workspace-relative folder (under projects/) for chat image uploads. */
export const CHAT_PICTURES_DIR = "Pictures";

export interface PromptImage {
  mediaType: string;
  data: string;
}

export interface PreparedAttachments {
  textAppend: string;
  images: PromptImage[];
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html", "xml", "yaml", "yml",
  "csv", "log", "toml", "ini", "sh", "py", "rs", "go", "java", "c", "cpp", "h", "sql",
]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = fileExtension(file.name);
  return ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "gif" || ext === "webp" || ext === "bmp";
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") return true;
  return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

export interface PreparedAttachmentItem {
  fileName: string;
  textAppend: string;
  image?: PromptImage;
}

export function mergePreparedAttachments(items: PreparedAttachmentItem[]): PreparedAttachments {
  let textAppend = "";
  const images: PromptImage[] = [];
  for (const item of items) {
    if (item.textAppend) textAppend += item.textAppend;
    if (item.image) images.push(item.image);
  }
  return { textAppend, images };
}

/** PI session history stores `<file name="...">…</file>` markers for attachments. */
const FILE_ATTACHMENT_TAG_RE = /<file name="[^"]*">[\s\S]*?<\/file>\n?/g;

/** Hide attachment markers from the chat transcript (model still sees them in session). */
export function stripFileAttachmentTags(text: string): string {
  return text.replace(FILE_ATTACHMENT_TAG_RE, "").trim();
}

/** Normalize image blocks from PI history (supports legacy Anthropic-style `source` blobs). */
export function parseHistoryImagePart(part: unknown): PromptImage | null {
  if (!part || typeof part !== "object") return null;
  const p = part as Record<string, unknown>;
  if (p.type !== "image") return null;

  const source =
    p.source && typeof p.source === "object" ? (p.source as Record<string, unknown>) : null;

  const mediaType =
    (typeof p.mimeType === "string" && p.mimeType) ||
    (typeof p.mediaType === "string" && p.mediaType) ||
    (typeof source?.mediaType === "string" && source.mediaType) ||
    (typeof source?.media_type === "string" && source.media_type) ||
    "";

  const data =
    (typeof p.data === "string" && p.data) ||
    (typeof source?.data === "string" && source.data) ||
    "";

  if (!mediaType || !data) return null;
  return { mediaType, data };
}

/** First `<file name="…">` in prompt text — used as image alt after history reload. */
export function fileNameFromAttachmentTags(text: string): string | undefined {
  const match = text.match(/<file name="([^"]+)">/);
  return match?.[1];
}

/** Human-readable preview for history lists, session titles, and tree nodes. */
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

export function isSupportedAttachmentFile(file: File): boolean {
  return isImageFile(file) || isTextFile(file);
}

/** Collect unique files from a paste/drop clipboard payload. */
export function filesFromClipboard(data: DataTransfer): File[] {
  // Browsers expose the same pasted image in both `.files` and `.items`, often
  // as different File objects (e.g. name "" vs "image.png", lastModified 0 vs now).
  // Prefer the FileList — it's the canonical paste source — and only fall back
  // to items when files is empty (some older paths only populate items).
  const fromFiles = Array.from(data.files).filter((file) => file.size > 0);
  if (fromFiles.length > 0) return fromFiles;

  const seen = new Set<string>();
  const out: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file || file.size === 0) continue;
    const key = `${file.size}:${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

export function normalizePastedFile(file: File, index: number): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
  const name = file.name || `pasted-${Date.now()}-${index}.${ext}`;
  if (file.name === name) return file;
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/** Unique path under Pictures/ for a chat upload (matches server persist layout). */
export function chatPictureFileName(originalName: string): string {
  const base = originalName.replace(/\\/g, "/").split("/").pop() || "image.png";
  const safe = base.replace(/[^\w.\-()+ ]+/g, "_").replace(/^\.+/, "") || "image.png";
  const dot = safe.lastIndexOf(".");
  const stem = (dot > 0 ? safe.slice(0, dot) : safe).slice(0, 80) || "image";
  const ext = dot > 0 ? safe.slice(dot) : ".jpg";
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${CHAT_PICTURES_DIR}/${stem}-${stamp}${ext}`;
}

export async function prepareSingleAttachment(
  file: File,
  options?: { onProgress?: (percent: number) => void }
): Promise<PreparedAttachmentItem> {
  if (file.size === 0) {
    throw new Error(`${file.name}: file is empty`);
  }

  if (isImageFile(file)) {
    options?.onProgress?.(5);
    const storedName = chatPictureFileName(file.name);
    const compressed = await compressImageFile(file, {
      maxBytes: MAX_UPLOAD_BYTES,
      onProgress: options?.onProgress,
    });
    if (!compressed) {
      return {
        fileName: storedName,
        textAppend: `<file name="${storedName}">[Image omitted: could not be compressed below 10 MB.]</file>\n`,
      };
    }
    const note = formatDimensionNote(compressed);
    options?.onProgress?.(100);
    return {
      fileName: storedName,
      textAppend: note
        ? `<file name="${storedName}">${note}</file>\n`
        : `<file name="${storedName}"></file>\n`,
      image: { mediaType: compressed.mediaType, data: compressed.data },
    };
  }

  if (!isTextFile(file)) {
    throw new Error(`${file.name}: only images and text files are supported`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} exceeds 10 MB limit`);
  }

  options?.onProgress?.(40);
  const content = await file.text();
  options?.onProgress?.(100);
  return {
    fileName: file.name,
    textAppend: `<file name="${file.name}">\n${content}\n</file>\n`,
  };
}

/** Mirrors PI's @file CLI processing: images become vision attachments, text files inline. */
export async function prepareAttachments(files: File[]): Promise<PreparedAttachments> {
  const items: PreparedAttachmentItem[] = [];
  for (const file of files) {
    items.push(await prepareSingleAttachment(file));
  }
  return mergePreparedAttachments(items);
}
