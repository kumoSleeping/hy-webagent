export interface BudgetView {
  budgetUsd: number | null;
  budgetUsedUsd: number;
  budgetRemainingUsd: number | null;
  budgetUnlimited: boolean;
}

const BUDGET_UNLIMITED = "∞";

/** USD display — small amounts keep extra precision so $0.0014 ≠ $0.00. */
export function formatUsd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  if (n === 0) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function budgetLeft(view: BudgetView): number | null {
  if (view.budgetUnlimited || view.budgetUsd === null) return null;
  return view.budgetRemainingUsd ?? Math.max(0, view.budgetUsd - view.budgetUsedUsd);
}

/** Budget summary: used / cap, or used / ∞ when unlimited. */
export function formatBudgetLine(view: BudgetView): string {
  const used = formatUsd(view.budgetUsedUsd);
  if (view.budgetUnlimited || view.budgetUsd === null) {
    return `${used} / ${BUDGET_UNLIMITED}`;
  }
  return `${used} / ${formatUsd(view.budgetUsd)}`;
}

export function budgetUsageRatio(view: BudgetView): number | null {
  if (view.budgetUnlimited || view.budgetUsd === null || view.budgetUsd <= 0) return null;
  return Math.min(1, view.budgetUsedUsd / view.budgetUsd);
}

export function isBudgetExhausted(view: BudgetView): boolean {
  if (view.budgetUnlimited || view.budgetUsd === null) return false;
  const left = budgetLeft(view);
  return left !== null && left <= 0;
}
