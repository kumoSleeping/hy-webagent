import { describe, expect, it } from "vitest";
import { BtwStreamSanitizer, sanitizeBtwAnswer } from "../pi/btw-text-sanitize.js";

describe("sanitizeBtwAnswer", () => {
  it("removes DSML tool call blocks", () => {
    const raw =
      '我来帮你搜索。\n<|DSML|tool_calls>\n<|DSML|invoke name="web_search">\n' +
      '<|DSML|parameter name="queries" string="false">["q"]</|DSML|parameter>\n' +
      "</|DSML|invoke>\n</|DSML|tool_calls>";
    expect(sanitizeBtwAnswer(raw)).toBe("我来帮你搜索。");
  });
});

describe("BtwStreamSanitizer", () => {
  it("strips DSML split across deltas", () => {
    const s = new BtwStreamSanitizer();
    expect(s.push("hello ")).toBe("hello ");
    expect(s.push("<|DSML|tool_calls>")).toBe("");
    expect(s.push('</|DSML|tool_calls>world')).toBe("world");
    expect(s.flush()).toBe("");
  });
});
