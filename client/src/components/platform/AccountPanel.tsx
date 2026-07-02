import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { fetchAccountProfile } from "../../hooks/useAccountProfileSync";
import { apiGet } from "../../lib/api";
import type { TokenUsage } from "../../types";
import {
  budgetUsageRatio,
  formatBudgetLine,
  formatUsd,
  isBudgetExhausted,
} from "../../lib/budgetDisplay";

export function AccountPanel() {
  const username = useAuthStore((s) => s.username);
  const displayName = useAuthStore((s) => s.displayName);
  const role = useAuthStore((s) => s.role);
  const budgetUsd = useAuthStore((s) => s.budgetUsd);
  const budgetUsedUsd = useAuthStore((s) => s.budgetUsedUsd);
  const budgetRemainingUsd = useAuthStore((s) => s.budgetRemainingUsd);
  const budgetUnlimited = useAuthStore((s) => s.budgetUnlimited);

  const [todayUsd, setTodayUsd] = useState<number | null>(null);

  useEffect(() => {
    fetchAccountProfile().catch(() => undefined);
    apiGet<TokenUsage>("/api/token/usage")
      .then((data) => setTodayUsd(data.costTodayUsd ?? 0))
      .catch(() => setTodayUsd(null));
  }, []);

  const handle = username || displayName || "user";
  const budgetView = { budgetUsd, budgetUsedUsd, budgetRemainingUsd, budgetUnlimited };
  const ratio = budgetUsageRatio(budgetView);
  const warn = ratio !== null && ratio >= 0.85;
  const exhausted = isBudgetExhausted(budgetView);

  return (
    <div className="pi-account-panel">
      <div className="pi-account-panel-row">
        <span className="pi-account-panel-label">Account</span>
        <span className="pi-account-panel-value">
          @{handle}
          {role === "admin" && <span className="pi-account-panel-muted"> · admin</span>}
        </span>
      </div>

      <div className={`pi-account-panel-row${warn || exhausted ? " pi-account-panel-row--warn" : ""}`}>
        <span className="pi-account-panel-label">Budget</span>
        <span className="pi-account-panel-value">{formatBudgetLine(budgetView)}</span>
      </div>

      {!budgetUnlimited && budgetUsd !== null && ratio !== null && (
        <div className="pi-account-panel-meter" aria-hidden="true">
          <div
            className={`pi-account-panel-meter-fill${warn || exhausted ? " pi-account-panel-meter-fill--warn" : ""}`}
            style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
          />
        </div>
      )}

      {todayUsd !== null && (
        <div className="pi-account-panel-row">
          <span className="pi-account-panel-label">Today</span>
          <span className="pi-account-panel-value">{formatUsd(todayUsd)}</span>
        </div>
      )}

      <Link to="/logout" className="pi-account-panel-logout">
        Log out
      </Link>
    </div>
  );
}
