import { describe, expect, it } from "vitest";
import {
  filterModels,
  isModelAllowed,
  normalizeModelTemplateId,
  resolveModelPolicy,
} from "../model-policy.js";

describe("model-policy", () => {
  it("treats missing template as unrestricted", () => {
    const policy = resolveModelPolicy({}, false);
    expect(policy.unrestricted).toBe(true);
    expect(isModelAllowed(policy, "anthropic", "claude-sonnet-4")).toBe(true);
  });

  it("admin always unrestricted", () => {
    const policy = resolveModelPolicy(
      { modelTemplateId: "budget-cn", modelAllow: [{ provider: "deepseek", modelId: "x" }] },
      true
    );
    expect(policy.unrestricted).toBe(true);
  });

  it("custom modelAllow overrides template", () => {
    const policy = resolveModelPolicy(
      {
        modelTemplateId: "budget-cn",
        modelAllow: [{ provider: "deepseek", modelId: "deepseek-v4-flash" }],
      },
      false
    );
    expect(policy.unrestricted).toBe(false);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-flash")).toBe(true);
    expect(isModelAllowed(policy, "xiaomi", "mimo-v2-flash")).toBe(false);
  });

  it("budget-cn allowlist filters models", () => {
    const policy = resolveModelPolicy({ modelTemplateId: "budget-cn" }, false);
    expect(policy.unrestricted).toBe(false);
    expect(isModelAllowed(policy, "deepseek", "deepseek-chat")).toBe(true);
    expect(isModelAllowed(policy, "xiaomi", "mimo-v2-flash")).toBe(true);
    expect(isModelAllowed(policy, "anthropic", "claude-sonnet-4")).toBe(false);

    const filtered = filterModels(policy, [
      { provider: "deepseek", id: "deepseek-chat" },
      { provider: "anthropic", id: "claude-sonnet-4" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.provider).toBe("deepseek");
  });

  it("normalizes full template id to null", () => {
    expect(normalizeModelTemplateId("full")).toBeNull();
    expect(normalizeModelTemplateId("budget-cn")).toBe("budget-cn");
  });
});
