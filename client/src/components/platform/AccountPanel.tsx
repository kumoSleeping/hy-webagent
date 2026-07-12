import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MessagesSquare, Plus } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { fetchAccountProfile } from "../../hooks/useAccountProfileSync";
import { apiGet, apiPost } from "../../lib/api";
import type { TokenUsage } from "../../types";
import {
  budgetUsageRatio,
  formatBudgetLine,
  formatUsd,
  isBudgetExhausted,
} from "../../lib/budgetDisplay";

interface SavedGroup {
  botSlug: string;
  channelId: string;
  displayName: string | null;
  botDisplayName: string;
  latestSessionId: string;
  viewUrl: string;
}

function GroupBrowser({ onBack }: { onBack: () => void }) {
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [channelId, setChannelId] = useState("");
  const [botSlug, setBotSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    apiGet<{ groups: SavedGroup[] }>("/api/groups")
      .then((data) => setGroups(data.groups ?? []))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取已保存群聊"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    const value = channelId.trim();
    if (!value || saving) return;
    setSaving(true);
    setError("");
    try {
      const slug = botSlug.trim().toLowerCase();
      if (!slug) return;
      const { group } = await apiPost<{ group: SavedGroup }>("/api/groups", { botSlug: slug, channelId: value });
      setGroups((current) => [group, ...current.filter((item) => item.botSlug !== group.botSlug || item.channelId !== group.channelId)]);
      setBotSlug("");
      setChannelId("");
      setShowCreate(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存群聊失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pi-group-browser">
      <div className="pi-group-browser-head">
        <button type="button" onClick={onBack} aria-label="返回用户信息"><ArrowLeft size={15} /></button>
        <strong>查看群聊中的工作进度</strong>
        <button type="button" className="pi-group-browser-new" onClick={() => setShowCreate((value) => !value)}>
          <Plus size={14} />
          新建
        </button>
      </div>
      {showCreate && <form className="pi-group-browser-form" onSubmit={saveGroup}>
        <input
          value={botSlug}
          onChange={(event) => setBotSlug(event.target.value)}
          placeholder="Bot"
          aria-label="Bot 名称"
        />
        <input
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
          placeholder="群号"
          aria-label="群号"
        />
        <button type="submit" disabled={!botSlug.trim() || !channelId.trim() || saving}>{saving ? "保存中" : "保存"}</button>
      </form>}
      {error && <p className="pi-group-browser-error">{error}</p>}
      <p className="pi-group-browser-config-hint">列表保存在 Workspace 的 saved-groups.json，可由你或 AI 直接编辑。</p>
      <div className="pi-group-browser-list pi-scrollbar">
        {loading && <p className="pi-group-browser-empty">正在读取…</p>}
        {!loading && groups.length === 0 && <p className="pi-group-browser-empty">还没有保存群聊</p>}
        {groups.map((group) => (
          <div className="pi-group-browser-row" key={`${group.botSlug}:${group.channelId}`}>
            <button type="button" className="pi-group-browser-open" onClick={() => window.location.assign(group.viewUrl)}>
              <MessagesSquare size={16} />
              <span>
                <strong>{group.displayName || `群聊 ${group.channelId}`}</strong>
                <small>/{group.botSlug}/{group.channelId} · {group.botDisplayName}</small>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountPanel() {
  const [showGroups, setShowGroups] = useState(false);
  const username = useAuthStore((s) => s.username);
  const displayName = useAuthStore((s) => s.displayName);
  const role = useAuthStore((s) => s.role);
  const budgetUsd = useAuthStore((s) => s.budgetUsd);
  const budgetUsedUsd = useAuthStore((s) => s.budgetUsedUsd);
  const budgetRemainingUsd = useAuthStore((s) => s.budgetRemainingUsd);
  const budgetUnlimited = useAuthStore((s) => s.budgetUnlimited);
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

  if (showGroups) return <GroupBrowser onBack={() => setShowGroups(false)} />;

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

      <button type="button" className="pi-account-panel-groups" onClick={() => setShowGroups(true)}>
        <MessagesSquare size={15} />
        查看群聊中的工作进度
      </button>

      <Link to="/logout" className="pi-account-panel-logout">
        Log out
      </Link>
    </div>
  );
}
