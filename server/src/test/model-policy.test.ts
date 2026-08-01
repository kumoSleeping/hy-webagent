import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_TEMPLATE_ID,
  filterModels,
  isModelAllowed,
  normalizeModelTemplateId,
  resolveModelPolicy,
} from "../model-policy.js";

describe("model-policy", () => {
  it("defaults missing template to deepseek-flash for every user", () => {
    const policy = resolveModelPolicy({}, false);
    expect(policy.unrestricted).toBe(false);
    expect(policy.templateId).toBe(DEFAULT_MODEL_TEMPLATE_ID);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-flash")).toBe(true);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-pro")).toBe(false);
    expect(isModelAllowed(policy, "xiaomi", "mimo-v2.5-pro-ultraspeed")).toBe(false);
    expect(isModelAllowed(policy, "xai", "grok-4.5")).toBe(false);
    expect(isModelAllowed(policy, "openai", "gpt-5.6-luna")).toBe(false);
    expect(isModelAllowed(policy, "anthropic", "claude-sonnet-4")).toBe(false);
  });

  it("admin shares the same default catalog", () => {
    const policy = resolveModelPolicy(
      { modelTemplateId: "deepseek-flash", modelAllow: [{ provider: "deepseek", modelId: "x" }] },
      true
    );
    // custom modelAllow still wins; admin is not a free pass past allowlists
    expect(policy.unrestricted).toBe(false);
    expect(isModelAllowed(policy, "deepseek", "x")).toBe(true);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-flash")).toBe(false);
  });

  it("custom modelAllow overrides template", () => {
    const policy = resolveModelPolicy(
      {
        modelTemplateId: "deepseek-flash",
        modelAllow: [{ provider: "deepseek", modelId: "deepseek-v4-flash" }],
      },
      false
    );
    expect(policy.unrestricted).toBe(false);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-flash")).toBe(true);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-pro")).toBe(false);
  });

  it("deepseek-flash allowlist filters models", () => {
    const policy = resolveModelPolicy({ modelTemplateId: "deepseek-flash" }, false);
    expect(policy.unrestricted).toBe(false);
    expect(policy.providers).toEqual(["deepseek"]);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-flash")).toBe(true);
    expect(isModelAllowed(policy, "deepseek", "deepseek-v4-pro")).toBe(false);
    expect(isModelAllowed(policy, "anthropic", "claude-sonnet-4")).toBe(false);

    const filtered = filterModels(policy, [
      { provider: "deepseek", id: "deepseek-v4-flash" },
      { provider: "deepseek", id: "deepseek-v4-pro" },
      { provider: "anthropic", id: "claude-sonnet-4" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("deepseek-v4-flash");
  });

  it("unknown template ids fall back to the default", () => {
    expect(normalizeModelTemplateId("full")).toBeNull();
    expect(normalizeModelTemplateId("deepseek-flash")).toBe("deepseek-flash");
    for (const modelTemplateId of ["full", "core-3", "budget-cn"]) {
      const policy = resolveModelPolicy({ modelTemplateId }, false);
      expect(policy.templateId).toBe(DEFAULT_MODEL_TEMPLATE_ID);
    }
  });
});
