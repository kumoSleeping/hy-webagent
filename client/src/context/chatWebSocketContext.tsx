import { createContext } from "react";
import type { ChatWebSocketApi } from "../hooks/useChatWebSocket";

export type { ConnectionState } from "../hooks/useChatWebSocket";

export const ChatWebSocketContext = createContext<ChatWebSocketApi | null>(null);

export function ChatWebSocketProvider({
  value,
  children,
}: {
  value: ChatWebSocketApi;
  children: React.ReactNode;
}) {
  return (
    <ChatWebSocketContext.Provider value={value}>{children}</ChatWebSocketContext.Provider>
  );
}
