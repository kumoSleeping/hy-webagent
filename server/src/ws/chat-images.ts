export const MAX_CHAT_IMAGE_COUNT = 4;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 32 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface ValidatedChatImage {
  mediaType: string;
  data: string;
}

export type ChatImageValidation =
  | { ok: true; images: ValidatedChatImage[] }
  | { ok: false; error: string };

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

export function decodedBase64Size(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const contentLength = data.length - padding;
  let finalValue = 0;
  for (let index = 0; index < contentLength; index += 1) {
    const value = base64Value(data.charCodeAt(index));
    if (value < 0) return null;
    finalValue = value;
  }
  for (let index = contentLength; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== 61) return null;
  }
  if (padding === 2 && (finalValue & 0b1111) !== 0) return null;
  if (padding === 1 && (finalValue & 0b11) !== 0) return null;
  return (data.length / 4) * 3 - padding;
}

export function validateChatImages(value: unknown): ChatImageValidation {
  if (value == null) return { ok: true, images: [] };
  if (!Array.isArray(value)) return { ok: false, error: "images must be an array" };
  if (value.length > MAX_CHAT_IMAGE_COUNT) {
    return { ok: false, error: `最多只能发送 ${MAX_CHAT_IMAGE_COUNT} 张图片` };
  }

  const images: ValidatedChatImage[] = [];
  let totalBytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") {
      return { ok: false, error: `图片 ${index + 1} 格式无效` };
    }
    const record = item as Record<string, unknown>;
    const mediaType = typeof record.mediaType === "string" ? record.mediaType.toLowerCase().trim() : "";
    const data = typeof record.data === "string" ? record.data : "";
    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      return { ok: false, error: `图片 ${index + 1} 类型不受支持：${mediaType || "unknown"}` };
    }
    const maxEncodedLength = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;
    if (data.length > maxEncodedLength) {
      return { ok: false, error: `图片 ${index + 1} 超过 10MB 限制` };
    }
    const decodedBytes = decodedBase64Size(data);
    if (decodedBytes == null) {
      return { ok: false, error: `图片 ${index + 1} 的 base64 数据无效` };
    }
    if (decodedBytes > MAX_CHAT_IMAGE_BYTES) {
      return { ok: false, error: `图片 ${index + 1} 超过 10MB 限制` };
    }
    totalBytes += decodedBytes;
    if (totalBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
      return { ok: false, error: "图片总量超过 32MB 限制" };
    }
    images.push({ mediaType, data });
  }
  return { ok: true, images };
}
