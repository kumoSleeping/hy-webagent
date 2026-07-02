import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { imageNamesFromPrompt, persistChatAttachments } from "../pi/chat-attachments.js";

describe("chat-attachments", () => {
  it("extracts image file tags but skips inline text files", () => {
    const text = [
      "hello",
      '<file name="notes.txt">',
      "content",
      "</file>",
      '<file name="shot.png"></file>',
      '<file name="wide.jpg">[Image: original 100x50, displayed at 80x40. Multiply coordinates by 1.25 to map to original image.]</file>',
    ].join("\n");

    expect(imageNamesFromPrompt(text)).toEqual(["shot.png", "wide.jpg"]);
  });

  it("writes decoded images into agent cwd", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-chat-attach-"));
    try {
      const data = Buffer.from("fake-image").toString("base64");
      await persistChatAttachments(
        dir,
        '看看\n\n<file name="image.png"></file>\n',
        [{ mediaType: "image/png", data }]
      );
      const written = await fs.readFile(path.join(dir, "image.png"));
      expect(written.toString()).toBe("fake-image");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
