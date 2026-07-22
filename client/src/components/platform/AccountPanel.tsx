import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, MessagesSquare, Plus, UserRound } from "lucide-react";
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
import { PanelBody, PanelListRow } from "../common/panel";

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
    <PanelBody
      variant="list"
      loading={loading}
      filter={
        <div className="pi-group-browser-head">
          <button type="button" onClick={onBack} aria-label="返回用户信息"><ArrowLeft size={15} /></button>
          <strong>查看群聊中的工作进度</strong>
          <button type="button" className="pi-group-browser-new" onClick={() => setShowCreate((value) => !value)}>
            <Plus size={14} />
            新建
          </button>
        </div>
      }
      empty={!loading && groups.length === 0 && !showCreate ? "还没有保存群聊" : undefined}
    >
      {showCreate && (
        <form className="pi-group-browser-form" onSubmit={saveGroup}>
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
          <button type="submit" disabled={!botSlug.trim() || !channelId.trim() || saving}>
            {saving ? "保存中" : "保存"}
          </button>
        </form>
      )}
      {error ? <div className="pi-panel-empty">{error}</div> : null}
      {!loading && groups.length > 0 ? (
        <p className="pi-group-browser-config-hint">列表保存在 Workspace 的 saved-groups.json，可由你或 AI 直接编辑。</p>
      ) : null}
      {groups.map((group) => (
        <PanelListRow
          key={`${group.botSlug}:${group.channelId}`}
          leading={<MessagesSquare size={14} strokeWidth={2} />}
          leadingKind="icon"
          title={group.displayName || `群聊 ${group.channelId}`}
          detail={`/${group.botSlug}/${group.channelId} · ${group.botDisplayName}`}
          onClick={() => window.location.assign(group.viewUrl)}
        />
      ))}
    </PanelBody>
  );
}

export function AccountPanel() {
  const navigate = useNavigate();
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
    <PanelBody
      variant="list"
      loading={todayLoading && todayUsd === null}
    >
      <PanelListRow
        leading={<UserRound size={14} strokeWidth={2} />}
        leadingKind="icon"
        title={`@${handle}`}
        detail={role === "admin" ? "admin" : "account"}
      />
      <PanelListRow
        leading="01"
        leadingKind="index"
        title={formatBudgetLine(budgetView)}
        detail={warn || exhausted ? "Budget · warn" : "Budget"}
      />
      {todayUsd !== null && (
        <PanelListRow
          leading="02"
          leadingKind="index"
          title={formatUsd(todayUsd)}
          detail="Today"
        />
      )}
      <PanelListRow
        leading={<MessagesSquare size={14} strokeWidth={2} />}
        leadingKind="icon"
        title="群聊记录"
        detail="查看已保存群聊中的工作进度"
        onClick={() => setShowGroups(true)}
      />
      <PanelListRow
        leading={<LogOut size={14} strokeWidth={2} />}
        leadingKind="icon"
        title="退出登录"
        detail="清除当前登录并返回登录页"
        onClick={() => navigate("/logout")}
      />
    </PanelBody>
  );
}
