import { describe, expect, it, beforeEach } from "vitest";
import { useChatStore } from "../stores/chatStore";

describe("chatStore transcript sync", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      currentAssistantId: null,
      queuedSteering: [],
      queuedFollowUp: [],
      hydratedPiSessionId: null,
    });
  });

  it("commitUserMessage splits a live assistant turn so steering lands mid-transcript", () => {
    const assistantId = useChatStore.getState().startAssistantMessage();
    useChatStore.getState().addToolCall(assistantId, {
      toolCallId: "tc-1",
      toolName: "read",
      input: {},
      status: "running",
    });

    useChatStore.getState().commitUserMessage({
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "等一下，先看这个" }],
      timestamp: 1000,
    });

    const { messages, currentAssistantId } = useChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.isStreaming).toBe(false);
    expect(messages[0]?.toolCalls?.[0]?.toolName).toBe("read");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toBe("等一下，先看这个");
    expect(currentAssistantId).toBeNull();

    const nextAssistantId = useChatStore.getState().ensureStreamingAssistant();
    expect(nextAssistantId).not.toBe(assistantId);
    expect(useChatStore.getState().messages).toHaveLength(3);
    expect(useChatStore.getState().messages[2]?.role).toBe("assistant");
    expect(useChatStore.getState().messages[2]?.isStreaming).toBe(true);
  });

  it("syncQueuedMessages only updates queue badges, not transcript", () => {
    useChatStore.getState().syncQueuedMessages(["queued"], []);
    expect(useChatStore.getState().queuedSteering).toEqual(["queued"]);
    expect(useChatStore.getState().messages).toHaveLength(0);

    useChatStore.getState().syncQueuedMessages([], []);
    expect(useChatStore.getState().queuedSteering).toEqual([]);
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("commitUserMessage deduplicates by server message id", () => {
    const raw = {
      id: "user-dup",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    };
    useChatStore.getState().commitUserMessage(raw);
    useChatStore.getState().commitUserMessage(raw);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it("startAssistantMessage reuses an existing streaming bubble (tool_start before agent_start)", () => {
    const firstId = useChatStore.getState().ensureStreamingAssistant();
    useChatStore.getState().addToolCall(firstId, {
      toolCallId: "tc-1",
      toolName: "read",
      input: {},
      status: "running",
    });

    const secondId = useChatStore.getState().startAssistantMessage();
    expect(secondId).toBe(firstId);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]?.blocks).toHaveLength(1);
  });

  it("finishAssistantMessage drops empty assistant orphans", () => {
    const assistantId = useChatStore.getState().startAssistantMessage();
    useChatStore.getState().finishAssistantMessage(assistantId);
    expect(useChatStore.getState().messages).toHaveLength(0);
  });
});
