import { describe, expect, it } from "vitest";
import { messageExportText, messageImageFilename } from "./messageExport";
import type { ChatMessage } from "../types";

const base: ChatMessage = { id: "m1", role: "assistant", content: "fallback", timestamp: Date.UTC(2026, 6, 11) };

describe("message export", () => {
  it("exports text blocks without thinking or tool content", () => {
    expect(messageExportText({
      ...base,
      blocks: [
        { type: "thinking", text: "secret" },
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    })).toBe("Hello world");
  });

  it("falls back to message content and creates a safe extension", () => {
    expect(messageExportText(base)).toBe("fallback");
    expect(messageImageFilename(base, "image/jpeg")).toMatch(/^pi-assistant-.*\.jpg$/);
  });
});
