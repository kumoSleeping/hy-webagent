import { createContext, useContext } from "react";
import type { ChatWebSocketApi } from "../hooks/useChatWebSocket";

const ChatWebSocketContext = createContext<ChatWebSocketApi | null>(null);

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

export function useChatConnection(): ChatWebSocketApi {
  const ctx = useContext(ChatWebSocketContext);
  if (!ctx) throw new Error("useChatConnection requires ChatWebSocketProvider");
  return ctx;
}
