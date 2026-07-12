import { useEffect, useState } from "react";
import { ChatWebSocketProvider } from "../../context/chatWebSocketContext";
import { useChatWebSocket } from "../../hooks/useChatWebSocket";
import { setGlobalLoaderActive } from "../../lib/globalLoader";
import { useAuthStore } from "../../stores/authStore";
import { useSessionStore, type SessionSummary } from "../../stores/sessionStore";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout";
import { GroupPreviewContext, type GroupPreviewInfo } from "./GroupPreviewContext";

interface DashboardSession {
  piSessionId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

interface DashboardData {
  bot: { slug: string; displayName: string };
  channel: { channelId: string; displayName: string | null };
  sessions: DashboardSession[];
}

function toSessionSummary(session: DashboardSession): SessionSummary {
  return {
    id: session.piSessionId,
    title: session.title || "未命名会话",
    timestamp: new Date(session.updatedAt || session.createdAt).toISOString(),
    messageCount: 0,
  };
}

export function GroupPreviewApp({
  channelId,
  botSlug,
}: {
  channelId: string;
  botSlug: string;
}) {
  const chat = useChatWebSocket();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    useAuthStore.getState().setGuestMode("", true);
    let cancelled = false;

    async function load() {
      try {
        const endpoint = `/api/public/bots/${encodeURIComponent(botSlug)}/channels/${encodeURIComponent(channelId)}`;
        const response = await fetch(endpoint);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        if (cancelled) return;
        const dashboard = body as DashboardData;
        const sessions = dashboard.sessions.map(toSessionSummary);
        setData(dashboard);
        setError("");
        useSessionStore.setState({ sessions, loading: false });

        const current = useSessionStore.getState().activePiSessionId;
        if (!current || !sessions.some((session) => session.id === current)) {
          const next = sessions[0]?.id ?? null;
          useSessionStore.getState().setActiveSession(next, { syncUrl: false });
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取群组会话");
      } finally {
        if (!cancelled) setGlobalLoaderActive(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [botSlug, channelId]);

  if (!data && !error) return null;
  if (!data) {
    return (
      <main className="pi-group-preview-error">
        <p>{error}</p>
        <button type="button" onClick={() => window.location.assign("/")}>返回正常聊天</button>
      </main>
    );
  }

  const context: GroupPreviewInfo = {
    botSlug: data.bot.slug,
    botDisplayName: data.bot.displayName,
    channelId: data.channel.channelId,
    channelDisplayName: data.channel.displayName || `群组 ${data.channel.channelId}`,
    selectSession: (nextSessionId) => {
      useSessionStore.getState().setActiveSession(nextSessionId, { syncUrl: false });
    },
    returnToChat: () => window.location.assign("/"),
  };

  return (
    <GroupPreviewContext.Provider value={context}>
      <ChatWebSocketProvider value={chat}>
        <WorkspaceLayout />
      </ChatWebSocketProvider>
    </GroupPreviewContext.Provider>
  );
}
