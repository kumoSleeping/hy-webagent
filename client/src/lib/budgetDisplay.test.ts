import { describe, it, expect } from "vitest";
import { formatBudgetLine, budgetUsageRatio, formatUsd } from "../lib/budgetDisplay";

describe("budgetDisplay", () => {
  it("formats capped budget as used / cap", () => {
    expect(
      formatBudgetLine({
        budgetUsd: 2,
        budgetUsedUsd: 0.0014,
        budgetRemainingUsd: 1.9986,
        budgetUnlimited: false,
      })
    ).toBe("$0.0014 / $2.00");
  });

  it("formats unlimited budget as used / ∞", () => {
    expect(
      formatBudgetLine({
        budgetUsd: null,
        budgetUsedUsd: 0.02,
        budgetRemainingUsd: null,
        budgetUnlimited: true,
      })
    ).toBe("$0.02 / ∞");
  });

  it("keeps precision for small spend", () => {
    expect(formatUsd(0.0014)).toBe("$0.0014");
  });

  it("warn ratio near cap", () => {
    const ratio = budgetUsageRatio({
      budgetUsd: 2,
      budgetUsedUsd: 1.8,
      budgetRemainingUsd: 0.2,
      budgetUnlimited: false,
    });
    expect(ratio).toBeCloseTo(0.9);
  });
});
