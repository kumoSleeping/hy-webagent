import { useAuthStore } from "../../../stores/authStore";
import { budgetUsageRatio, formatBudgetLine } from "../../../lib/budgetDisplay";

export function AccountBudgetSlot() {
  const username = useAuthStore((s) => s.username);
  const displayName = useAuthStore((s) => s.displayName);
  const role = useAuthStore((s) => s.role);
  const budgetUsd = useAuthStore((s) => s.budgetUsd);
  const budgetUsedUsd = useAuthStore((s) => s.budgetUsedUsd);
  const budgetRemainingUsd = useAuthStore((s) => s.budgetRemainingUsd);
  const budgetUnlimited = useAuthStore((s) => s.budgetUnlimited);

  const label = username || displayName || "user";
  const view = {
    budgetUsd,
    budgetUsedUsd,
    budgetRemainingUsd,
    budgetUnlimited,
  };
  const ratio = budgetUsageRatio(view);
  const warn = ratio !== null && ratio >= 0.85;

  return (
    <div className="pi-web-chrome-account" aria-label="Account and budget">
      <span className="pi-web-chrome-account-user">@{label}</span>
      {role === "admin" && <span className="pi-web-chrome-account-badge">admin</span>}
      <span className={`pi-web-chrome-account-budget${warn ? " pi-web-chrome-account-budget--warn" : ""}`}>
        {formatBudgetLine(view)}
      </span>
    </div>
  );
}
