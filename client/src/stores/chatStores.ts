/**
 * v2 多会话小窗的 store 注册表(docs/10 §3)。
 *
 * 激活会话保持既有单例 chatStore 全链路不动;这里只服务会话小窗:
 * 每个开着的小窗一个独立 ChatStore 实例,useChatIpc 按事件 sessionId
 * 路由进来。激活会话若同时开着窗 = 单例 + 小窗双写,内容一致。
 *
 * applyChatEventToWindowStore 是 dispatchWsMessage 的 transcript 子集转写:
 * 只做消息流变更,不碰全局 store(footer/status/extension)、不 flash。
 * 改动 dispatchWsMessage 的 chat:* 分支时必须同步这里(docs/10 §3)。
 */
import { createChatStore, type ChatStoreApi } from "./chatStore";

const registry = new Map<string, ChatStoreApi>();

export function ensureChatStore(sessionId: string): ChatStoreApi {
  let api = registry.get(sessionId);
  if (!api) {
    api = createChatStore();
    registry.set(sessionId, api);
  }
  return api;
}

export function peekChatStore(sessionId: string): ChatStoreApi | null {
  return registry.get(sessionId) ?? null;
}

export function dropChatStore(sessionId: string): void {
  registry.delete(sessionId);
}

/** 事件路由入口:该会话开着小窗(在册)才应用,否则丢弃。 */
export function routeEventToSessionWindow(
  sessionId: string,
  msg: { type: string; payload: unknown },
): void {
  const api = registry.get(sessionId);
  if (api) applyChatEventToWindowStore(api, msg as { type: string; payload: never });
}

export function applyChatEventToWindowStore(
  api: ChatStoreApi,
  msg: { type: string; payload: any },
): void {
  const store = api.getState;
  switch (msg.type) {
    case "chat:history": {
      store().loadHistory(msg.payload?.messages || [], {
        agentRunning: Boolean(msg.payload?.agentRunning),
        serverToolActivities: msg.payload?.serverToolActivities,
      });
      break;
    }
    case "chat:user_message": {
      const raw = msg.payload?.message;
      if (msg.payload?.phase === "end" && raw?.role === "user") {
        store().commitUserMessage(raw);
      }
      break;
    }
    case "chat:assistant_start": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      store().startAssistantMessage(messageId);
      break;
    }
    case "chat:text_delta": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = messageId ? store().startAssistantMessage(messageId) : store().ensureStreamingAssistant();
      store().appendTextDelta(aid, msg.payload.delta, msg.payload.contentIndex);
      break;
    }
    case "chat:thinking_delta": {
      const messageId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = messageId ? store().startAssistantMessage(messageId) : store().ensureStreamingAssistant();
      store().appendThinkingDelta(aid, msg.payload.delta, msg.payload.contentIndex);
      break;
    }
    case "chat:tool_start": {
      const requestedId = typeof msg.payload?.messageId === "string" ? msg.payload.messageId : undefined;
      const aid = requestedId && store().messages.some((m) => m.id === requestedId)
        ? requestedId
        : store().ensureStreamingAssistant();
      store().addToolCall(aid, {
        toolCallId: msg.payload.toolCallId,
        toolName: msg.payload.toolName,
        input: msg.payload.input,
        status: "running",
      });
      break;
    }
    case "chat:tool_update": {
      const aid = store().messages.find((m) => m.toolCalls?.some((tool) => tool.toolCallId === msg.payload.toolCallId))?.id
        ?? store().currentAssistantId
        ?? store().ensureStreamingAssistant();
      store().updateToolCall(aid, msg.payload.toolCallId, msg.payload.output);
      break;
    }
    case "chat:tool_end": {
      const aid = store().messages.find((m) => m.toolCalls?.some((tool) => tool.toolCallId === msg.payload.toolCallId))?.id
        ?? store().currentAssistantId
        ?? store().ensureStreamingAssistant();
      store().endToolCall(
        aid,
        msg.payload.toolCallId,
        msg.payload.isError,
        msg.payload.details,
        msg.payload.output,
        msg.payload.input,
      );
      break;
    }
    case "chat:assistant_end": {
      const messageId = typeof msg.payload?.messageId === "string"
        ? msg.payload.messageId
        : store().currentAssistantId;
      if (messageId) {
        store().finishAssistantTurn(
          messageId,
          typeof msg.payload?.stopReason === "string" ? msg.payload.stopReason : undefined,
          msg.payload?.textSignatures,
        );
      }
      break;
    }
    case "chat:agent_start":
      store().ensureStreamingAssistant();
      break;
    case "chat:agent_end":
      store().finishAgentRun();
      break;
    case "chat:queue_update": {
      const steering: string[] = Array.isArray(msg.payload?.steering) ? msg.payload.steering : [];
      const followUp: string[] = Array.isArray(msg.payload?.followUp) ? msg.payload.followUp : [];
      store().syncQueuedMessages(steering, followUp);
      break;
    }
    case "chat:error": {
      const errorText = typeof msg.payload?.message === "string" && msg.payload.message.trim()
        ? msg.payload.message.trim()
        : "Chat error";
      const errorMessageId = typeof msg.payload?.messageId === "string"
        ? msg.payload.messageId
        : store().currentAssistantId;
      if (errorMessageId) store().setAssistantError(errorMessageId, errorText);
      store().setStreaming(false);
      break;
    }
    default:
      break;
  }
}
