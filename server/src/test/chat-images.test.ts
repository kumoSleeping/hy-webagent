import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_COUNT,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  decodedBase64Size,
  validateChatImages,
} from "../ws/chat-images.js";

function image(bytes: number, mediaType = "image/jpeg") {
  return {
    mediaType,
    data: Buffer.alloc(bytes, 1).toString("base64"),
  };
}

describe("chat image validation", () => {
  it("accepts supported images within the limits", () => {
    const result = validateChatImages([image(1024), image(2048, "image/png")]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.images).toHaveLength(2);
  });

  it("rejects too many images", () => {
    const result = validateChatImages(Array.from({ length: MAX_CHAT_IMAGE_COUNT + 1 }, () => image(1)));

    expect(result).toEqual({ ok: false, error: "最多只能发送 4 张图片" });
  });

  it("rejects a single oversized image", () => {
    const result = validateChatImages([image(MAX_CHAT_IMAGE_BYTES + 1)]);

    expect(result).toEqual({ ok: false, error: "图片 1 超过 10MB 限制" });
  });

  it("rejects images over the total limit", () => {
    const each = Math.floor(MAX_CHAT_IMAGE_TOTAL_BYTES / 4) + 1;
    const result = validateChatImages(Array.from({ length: 4 }, () => image(each)));

    expect(result).toEqual({ ok: false, error: "图片总量超过 32MB 限制" });
  });

  it("rejects invalid base64 and unsupported media", () => {
    expect(validateChatImages([{ mediaType: "image/jpeg", data: "%%%" }])).toEqual({
      ok: false,
      error: "图片 1 的 base64 数据无效",
    });
    expect(validateChatImages([image(1, "image/svg+xml")])).toEqual({
      ok: false,
      error: "图片 1 类型不受支持：image/svg+xml",
    });
  });

  it("calculates padded base64 sizes exactly", () => {
    expect(decodedBase64Size(Buffer.from("a").toString("base64"))).toBe(1);
    expect(decodedBase64Size(Buffer.from("ab").toString("base64"))).toBe(2);
    expect(decodedBase64Size(Buffer.from("abc").toString("base64"))).toBe(3);
  });

  it("rejects non-canonical padding bits", () => {
    expect(decodedBase64Size("AR==")).toBeNull();
    expect(decodedBase64Size("AAF=")).toBeNull();
  });
});
