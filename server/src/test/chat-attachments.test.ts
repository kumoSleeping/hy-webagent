import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CHAT_PICTURES_DIR,
  imageNamesFromPrompt,
  persistChatAttachments,
  resolveChatPictureRelPath,
} from "../pi/chat-attachments.js";

describe("chat-attachments", () => {
  it("extracts image file tags but skips inline text files", () => {
    const text = [
      "hello",
      '<file name="notes.txt">',
      "content",
      "</file>",
      '<file name="Pictures/shot.png"></file>',
      '<file name="wide.jpg">[Image: original 100x50, displayed at 80x40. Multiply coordinates by 1.25 to map to original image.]</file>',
    ].join("\n");

    expect(imageNamesFromPrompt(text)).toEqual(["Pictures/shot.png", "wide.jpg"]);
  });

  it("resolves names under Pictures/", () => {
    expect(resolveChatPictureRelPath("shot.png", 0)).toBe("Pictures/shot.png");
    expect(resolveChatPictureRelPath("Pictures/shot.png", 0)).toBe("Pictures/shot.png");
    expect(resolveChatPictureRelPath("nested/a.png", 0)).toBe("Pictures/a.png");
  });

  it("writes decoded images into projects/Pictures", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-chat-attach-"));
    try {
      const data = Buffer.from("fake-image").toString("base64");
      await persistChatAttachments(
        dir,
        '看看\n\n<file name="Pictures/image.png"></file>\n',
        [{ mediaType: "image/png", data }]
      );
      const written = await fs.readFile(path.join(dir, CHAT_PICTURES_DIR, "image.png"));
      expect(written.toString()).toBe("fake-image");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("avoids overwriting an existing picture", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-chat-attach-"));
    try {
      const pictures = path.join(dir, CHAT_PICTURES_DIR);
      await fs.mkdir(pictures, { recursive: true });
      await fs.writeFile(path.join(pictures, "image.png"), "first");
      await persistChatAttachments(
        dir,
        '<file name="image.png"></file>\n',
        [{ mediaType: "image/png", data: Buffer.from("second").toString("base64") }]
      );
      expect(await fs.readFile(path.join(pictures, "image.png"), "utf8")).toBe("first");
      expect(await fs.readFile(path.join(pictures, "image-2.png"), "utf8")).toBe("second");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
