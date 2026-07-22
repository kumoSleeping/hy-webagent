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
  it("accepts models shorthand array", async () => {
    expect(
      await parseModelFilterBody({
        models: ["deepseek/deepseek-v4-flash", "xiaomi/mimo-v2-flash"],
      })
    ).toEqual([
      { provider: "deepseek", modelId: "deepseek-v4-flash" },
      { provider: "xiaomi", modelId: "mimo-v2-flash" },
    ]);
  });

  it("accepts allow rule objects", async () => {
    expect(
      await parseModelFilterBody({
        allow: [{ provider: "deepseek", modelId: "deepseek-v4-flash" }],
      })
    ).toEqual([{ provider: "deepseek", modelId: "deepseek-v4-flash" }]);
  });

  it("clears filter with null", async () => {
    expect(await parseModelFilterBody({ allow: null })).toBeNull();
    expect(await parseModelFilterBody({ models: null })).toBeNull();
  });

  it("rejects empty allowlists", async () => {
    await expect(parseModelFilterBody({ models: [] })).rejects.toThrow(/at least one/i);
  });
});
