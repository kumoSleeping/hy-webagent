import { useEffect, useRef } from "react";
import { apiGet } from "../lib/api";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import {
  normalizeWidgetSnapshot,
  useStatusBarStore,
  type FooterSnapshot,
  type WidgetSnapshot,
} from "../stores/statusBarStore";

export interface StatusApiResponse {
  footer: FooterSnapshot;
  widgets: WidgetSnapshot;
  plugins: Record<string, string>;
  /** True while the server-side agent loop is still running (survives tab close). */
  agentRunning?: boolean;
}

export function applyStatusPayload(data: StatusApiResponse) {
  const store = useStatusBarStore.getState();
  if (data.footer) store.setFooter(data.footer);
  if (data.widgets) store.setWidgets(normalizeWidgetSnapshot(data.widgets));
  if (data.plugins) store.applyPluginSnapshot(data.plugins);
  if (data.agentRunning) useChatStore.getState().resumeAgentRun();
}

/** Pull footer/widgets/plugins for a Pi session — safe to call right after HTTP activate. */
export async function fetchSessionStatus(piSessionId: string): Promise<void> {
  const data = await apiGet<StatusApiResponse>(
    `/api/sessions/${encodeURIComponent(piSessionId)}/status`
  );
  applyStatusPayload(data);
}

/**
 * Keep the status bar in sync with the active Pi session.
 * Uses REST immediately on session change — does not wait for chat WS hydration.
 */
export function useStatusBarSync() {
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  const prevSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = activePiSessionId;

    if (!activePiSessionId) return;

    if (prev && prev !== activePiSessionId) {
      useStatusBarStore.getState().clear();
    }

    fetchSessionStatus(activePiSessionId).catch((err) =>
      console.warn("status bar sync failed:", err)
    );
  }, [activePiSessionId]);
}
