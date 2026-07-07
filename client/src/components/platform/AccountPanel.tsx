import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { fetchAccountProfile } from "../../hooks/useAccountProfileSync";
import { useStartupPreferencesStore } from "../../stores/startupPreferencesStore";
import { apiGet } from "../../lib/api";
import type { TokenUsage } from "../../types";
import type { StartupComposerPosition } from "../../lib/startupPreferences";
import {
  budgetUsageRatio,
  formatBudgetLine,
  formatUsd,
  isBudgetExhausted,
} from "../../lib/budgetDisplay";

const STARTUP_LAYOUT_OPTIONS: { value: StartupComposerPosition; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
];

export function AccountPanel() {
  const username = useAuthStore((s) => s.username);
  const displayName = useAuthStore((s) => s.displayName);
  const role = useAuthStore((s) => s.role);
  const budgetUsd = useAuthStore((s) => s.budgetUsd);
  const budgetUsedUsd = useAuthStore((s) => s.budgetUsedUsd);
  const budgetRemainingUsd = useAuthStore((s) => s.budgetRemainingUsd);
  const budgetUnlimited = useAuthStore((s) => s.budgetUnlimited);
  const welcomeEnabled = useStartupPreferencesStore((s) => s.welcomeEnabled);
  const composerPosition = useStartupPreferencesStore((s) => s.composerPosition);
  const setWelcomeEnabled = useStartupPreferencesStore((s) => s.setWelcomeEnabled);
  const setComposerPosition = useStartupPreferencesStore((s) => s.setComposerPosition);

  const [todayUsd, setTodayUsd] = useState<number | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);

  useEffect(() => {
    fetchAccountProfile().catch(() => undefined);
    apiGet<TokenUsage>("/api/token/usage")
      .then((data) => setTodayUsd(data.costTodayUsd ?? 0))
      .catch(() => setTodayUsd(null))
      .finally(() => setTodayLoading(false));
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
      {todayLoading && todayUsd === null && (
        <div className="pi-account-panel-row">
          <span className="pi-account-panel-label">Today</span>
          <span className="pi-account-panel-value pi-account-panel-muted">…</span>
        </div>
      )}

      <div className="pi-account-panel-prefs">
        <div className="pi-account-panel-row pi-account-panel-row--pref">
          <span className="pi-account-panel-label">Welcome line</span>
          <label className="pi-account-panel-toggle">
            <input
              type="checkbox"
              checked={welcomeEnabled}
              onChange={(e) => setWelcomeEnabled(e.target.checked)}
            />
            <span className="pi-account-panel-toggle-ui" aria-hidden="true" />
            <span className="pi-account-panel-toggle-label">{welcomeEnabled ? "On" : "Off"}</span>
          </label>
        </div>

        <div className="pi-account-panel-row pi-account-panel-row--pref">
          <span className="pi-account-panel-label">Startup layout</span>
          <div className="pi-account-panel-segment" role="group" aria-label="Startup composer position">
            {STARTUP_LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="pi-account-panel-segment-btn"
                data-active={composerPosition === option.value}
                aria-pressed={composerPosition === option.value}
                onClick={() => setComposerPosition(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="pi-account-panel-pref-hint">
          Auto: phone bottom, desktop center. Saved in this browser.
        </p>
      </div>

      <Link to="/logout" className="pi-account-panel-logout">
        Log out
      </Link>
    </div>
  );
}
