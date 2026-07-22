import { describe, it, expect } from "vitest";
import { extractToolTarget, formatToolContent, getToolDisplayLabel, isGarbageToolOutput } from "../lib/toolDisplay";

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

  it("shows completed Grok search and open-page actions", () => {
    expect(extractToolTarget("web_search", {
      type: "search",
      query: "AI news",
      sources: [{ url: "a" }, { url: "b" }],
    })).toBe('"AI news" · 2 sources');
    expect(extractToolTarget("web_search", {
      type: "open_page",
      url: "https://example.com/article",
    })).toBe("https://example.com/article");
  });

  it("gives every Grok native tool and web action its own label", () => {
    expect(getToolDisplayLabel("web_search", { type: "search" })).toBe("Web Search");
    expect(getToolDisplayLabel("web_search", { type: "open_page" })).toBe("Open Page");
    expect(getToolDisplayLabel("web_search", { type: "find_in_page" })).toBe("Find on Page");
    expect(getToolDisplayLabel("x_search")).toBe("X Search");
    expect(getToolDisplayLabel("code_interpreter")).toBe("Code Interpreter");
    expect(getToolDisplayLabel("view_image")).toBe("View Image");
    expect(getToolDisplayLabel("view_x_video")).toBe("View X Video");
  });
});
