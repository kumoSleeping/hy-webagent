import type { EditorMediaType } from "../types";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico",
]);
const AUDIO_EXTS = new Set([
  "mp3", "wav", "ogg", "m4a", "flac", "aac",
]);
const VIDEO_EXTS = new Set([
  "mp4", "webm", "mov", "avi", "mkv",
]);

export function getMediaType(filename: string): EditorMediaType | null {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return null;
}

export function isMediaFile(filename: string): boolean {
  return getMediaType(filename) !== null;
}

export function mimeTypeForMedia(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "ogg": return "audio/ogg";
    case "m4a": return "audio/mp4";
    case "flac": return "audio/flac";
    case "aac": return "audio/aac";
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "mov": return "video/quicktime";
    case "avi": return "video/x-msvideo";
    case "mkv": return "video/x-matroska";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

export function dataUrlForMedia(filename: string, base64: string): string {
  return `data:${mimeTypeForMedia(filename)};base64,${base64}`;
}
