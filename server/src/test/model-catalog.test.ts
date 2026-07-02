import { describe, expect, it } from "vitest";
import { parseModelFilterBody, parseModelKey } from "../model-catalog.js";

describe("parseModelKey", () => {
  it("parses provider/modelId keys", () => {
    expect(parseModelKey("deepseek/deepseek-v4-flash")).toEqual({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
    });
  });

  it("rejects invalid keys", () => {
    expect(() => parseModelKey("not-a-key")).toThrow(/Invalid model key/i);
  });
});

describe("parseModelFilterBody", () => {
  it("accepts models shorthand array", () => {
    expect(
      parseModelFilterBody({
        models: ["deepseek/deepseek-v4-flash", "xiaomi/mimo-v2-flash"],
      })
    ).toEqual([
      { provider: "deepseek", modelId: "deepseek-v4-flash" },
      { provider: "xiaomi", modelId: "mimo-v2-flash" },
    ]);
  });

  it("accepts allow rule objects", () => {
    expect(
      parseModelFilterBody({
        allow: [{ provider: "deepseek", modelId: "deepseek-v4-flash" }],
      })
    ).toEqual([{ provider: "deepseek", modelId: "deepseek-v4-flash" }]);
  });

  it("clears filter with null", () => {
    expect(parseModelFilterBody({ allow: null })).toBeNull();
    expect(parseModelFilterBody({ models: null })).toBeNull();
  });

  it("rejects empty allowlists", () => {
    expect(() => parseModelFilterBody({ models: [] })).toThrow(/at least one/i);
  });
});
