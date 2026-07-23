import { describe, expect, it } from "vitest";
import {
  DIRECT_IMAGE_GUIDANCE,
  fileNameFromAttachmentTags,
  filesFromClipboard,
  formatUserMessagePreview,
  isSupportedAttachmentFile,
  isTextFile,
  mergePreparedAttachments,
  parseHistoryImagePart,
  prepareAttachments,
  prepareSingleAttachment,
  stripFileAttachmentTags,
} from "./prepareAttachments";

describe("prepareAttachments", () => {
  it("tells vision models that the saved file is the already attached image", () => {
    expect(DIRECT_IMAGE_GUIDANCE).toMatch(/^\[Image attachment already included/);
    expect(DIRECT_IMAGE_GUIDANCE).toContain("Inspect the attached image directly");
    expect(DIRECT_IMAGE_GUIDANCE).toContain("do not use bash, read, describe_image, or view_image");
  });

  it("wraps text files like PI @file", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(isTextFile(file)).toBe(true);
    expect(isSupportedAttachmentFile(file)).toBe(true);

    const result = await prepareAttachments([file]);
    expect(result.images).toEqual([]);
    expect(result.textAppend).toContain('<file name="notes.txt">');
    expect(result.textAppend).toContain("hello");
  });

  it("rejects unsupported binary files", async () => {
    const file = new File([new Uint8Array([0, 1, 2])], "data.bin", { type: "application/octet-stream" });
    await expect(prepareAttachments([file])).rejects.toThrow(/only images and text files/i);
  });

  it("merges prepared attachment chunks", async () => {
    const file = new File(["a"], "a.txt", { type: "text/plain" });
    const item = await prepareSingleAttachment(file);
    const merged = mergePreparedAttachments([item]);
    expect(merged.textAppend).toContain("a");
    expect(merged.images).toEqual([]);
  });

  it("dedupes clipboard files", () => {
    const file = new File(["x"], "clip.txt", { type: "text/plain" });
    const data = {
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(data)).toHaveLength(1);
  });

  it("does not duplicate pasted images from files and items", () => {
    const fromFiles = new File(["img"], "image.png", { type: "image/png" });
    const fromItems = new File(["img"], "", { type: "image/png", lastModified: 0 });
    const data = {
      files: [fromFiles],
      items: [{ kind: "file", getAsFile: () => fromItems }],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(data)).toHaveLength(1);
    expect(filesFromClipboard(data)[0]).toBe(fromFiles);
  });

  it("falls back to items when files list is empty", () => {
    const file = new File(["y"], "paste.txt", { type: "text/plain" });
    const data = {
      files: [],
      items: [{ kind: "file", getAsFile: () => file }],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(data)).toEqual([file]);
  });

  it("strips file attachment tags from display text", () => {
    const text = 'hello\n\n<file name="image.png"></file>\n';
    expect(stripFileAttachmentTags(text)).toBe("hello");
    expect(fileNameFromAttachmentTags(text)).toBe("image.png");
  });

  it("parses PI and legacy image history blocks", () => {
    expect(parseHistoryImagePart({
      type: "image",
      mimeType: "image/jpeg",
      data: "abc123",
    })).toEqual({ mediaType: "image/jpeg", data: "abc123" });

    expect(parseHistoryImagePart({
      type: "image",
      source: { type: "base64", mediaType: "image/png", data: "legacy" },
    })).toEqual({ mediaType: "image/png", data: "legacy" });

    expect(parseHistoryImagePart({ type: "image" })).toBeNull();
  });

  it("formats attachment-only prompts for list previews", () => {
    expect(formatUserMessagePreview('<file name="image.png"></file>')).toBe("image.png");
    expect(formatUserMessagePreview('你好\n\n<file name="image.png"></file>')).toBe("你好");
  });
});
