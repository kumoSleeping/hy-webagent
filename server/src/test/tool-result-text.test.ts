import { describe, it, expect } from "vitest";
import { toolResultToText } from "../ws/tool-result-text.js";

describe("toolResultToText", () => {
  it("extracts text from PI bash partialResult shape", () => {
    const text = toolResultToText({
      content: [{ type: "text", text: '{"users":[{"username":"alice"}]}' }],
      details: { truncation: null },
    });
    expect(text).toContain("alice");
    expect(text).not.toContain("[object Object]");
  });

  it("stringifies plain objects without [object Object]", () => {
    const text = toolResultToText({ users: [{ username: "alice" }] });
    expect(text).toContain("alice");
    expect(JSON.parse(text)).toEqual({ users: [{ username: "alice" }] });
  });
});
