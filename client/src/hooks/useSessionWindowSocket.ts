/**
 * 会话小窗的专用只读直播管道(多会话直播,docs/design-cleanup/10)。
 *
 * 每窗一条 WS:`?sessionId=<auth>&piSessionId=<会话>&view=1` —— 服务端的
 * owner feed-view 分支:直连订阅本会话事件,绝不抢主 socket 的事件槽;
 * 写入被 writableTypes 拦截(composer 永远走主 socket 发激活会话)。
 *
 * chat:history → loadHistory + completeHydration;其余 chat:* 事件走
 * applyChatEventToWindowStore(与桌面同一份转写子集)。refresh() 发
 * ui:request_snapshot 触发服务端重发全量历史 —— 小窗对账用
 * (中途开窗丢在途半条 / 回合结束 / 激活切走)。
 */
import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { applyChatEventToWindowStore } from "../stores/chatStores";
import type { ChatStoreApi } from "../stores/chatStore";

const RECONNECT_DELAY_MS = 2000;

export function useSessionWindowSocket(
  piSessionId: string,
  chatStore: ChatStoreApi,
): { refresh: () => void } {
  const authToken = useAuthStore((s) => s.sessionId);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!authToken) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (disposed) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${location.host}/ws/chat?sessionId=${authToken}&piSessionId=${piSessionId}&view=1`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        ws.send(JSON.stringify({ type: "ui:request_snapshot", payload: {} }));
      };

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;
        let msg: { type: string; payload: any };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === "chat:history") {
          const st = chatStore.getState();
          st.loadHistory(msg.payload?.messages || [], {
            agentRunning: Boolean(msg.payload?.agentRunning),
            serverToolActivities: msg.payload?.serverToolActivities,
          });
          st.completeHydration(piSessionId);
          return;
        }
        applyChatEventToWindowStore(chatStore, msg);
      };

      ws.onclose = () => {
        if (disposed || wsRef.current !== ws) return;
        wsRef.current = null;
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // close 失败无所谓,onclose 兜底重连。
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        ws?.close();
      } catch {
        // 卸载路径不阻塞。
      }
    };
  }, [authToken, piSessionId, chatStore]);

  const refresh = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "ui:request_snapshot", payload: {} }));
    }
  }, []);

  return { refresh };
}
