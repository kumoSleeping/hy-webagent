import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_TEMPLATE_ID,
  filterModels,
  isModelAllowed,
  normalizeModelTemplateId,
  resolveModelPolicy,
} from "../model-policy.js";

describe("model-policy", () => {
  it("defaults missing template to core-3 for every user", () => {
    const policy = resolveModelPolicy({}, false);
    expect(policy.unrestricted).toBe(false);
    expect(policy.templateId).toBe(DEFAULT_MODEL_TEMPLATE_ID);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-pro")).toBe(true);
    expect(isModelAllowed(policy, "xiaomi", "mimo-v2.5-pro-ultraspeed")).toBe(true);
    expect(isModelAllowed(policy, "soruxgpt", "grok-4.5")).toBe(true);
    expect(isModelAllowed(policy, "anthropic", "claude-sonnet-4")).toBe(false);
  });

  it("admin shares the same default catalog", () => {
    const policy = resolveModelPolicy(
      { modelTemplateId: "budget-cn", modelAllow: [{ provider: "deepseek", modelId: "x" }] },
      true
    );
    // custom modelAllow still wins; admin is not a free pass past allowlists
    expect(policy.unrestricted).toBe(false);
    expect(isModelAllowed(policy, "deepseek", "x")).toBe(true);
    expect(isModelAllowed(policy, "xiaomi", "mimo-v2-flash")).toBe(false);
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

  it("normalizes full template id to null (then falls back to core-3)", () => {
    expect(normalizeModelTemplateId("full")).toBeNull();
    expect(normalizeModelTemplateId("budget-cn")).toBe("budget-cn");
    const policy = resolveModelPolicy({ modelTemplateId: "full" }, false);
    expect(policy.templateId).toBe(DEFAULT_MODEL_TEMPLATE_ID);
  });
});
