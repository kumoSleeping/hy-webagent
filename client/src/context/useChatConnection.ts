import { useContext } from "react";
import type { ChatWebSocketApi, ConnectionState } from "../hooks/useChatWebSocket";
import { ChatWebSocketContext } from "./chatWebSocketContext";

export function useChatConnection(): ChatWebSocketApi {
  const ctx = useContext(ChatWebSocketContext);
  if (!ctx) throw new Error("useChatConnection requires ChatWebSocketProvider");
  return ctx;
}

export function useConnectionState(): ConnectionState {
  const ctx = useContext(ChatWebSocketContext);
  return ctx?.connectionState ?? 'disconnected';
}
