import { describe, it, expect } from "vitest";
import { formatToolContent, isGarbageToolOutput } from "../lib/toolDisplay";

describe("toolDisplay", () => {
  it("detects corrupted object stringification", () => {
    expect(isGarbageToolOutput("[object Object][object Object]")).toBe(true);
    expect(isGarbageToolOutput('{"users":[]}')).toBe(false);
  });

  it("formats PI bash result content blocks", () => {
    const text = formatToolContent({
      content: [{ type: "text", text: "hello\nworld" }],
    });
    expect(text).toBe("hello\nworld");
  });
});
