import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SEND_MESSAGE_TOOL, createBotChannelFactory } from "../pi/extensions/bot-channel.js";

type InputHandler = (event: { text: string }) => Promise<{ action: string }>;

/** Minimal ExtensionAPI stand-in that captures what the factory registers. */
function harness() {
  let tool: ToolDefinition<any, any, any> | undefined;
  let onInput: InputHandler | undefined;
  const pi = {
    on: (event: string, handler: unknown) => {
      if (event === "input") onInput = handler as InputHandler;
    },
    registerTool: (definition: ToolDefinition<any, any, any>) => {
      tool = definition;
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    get tool() {
      if (!tool) throw new Error("tool was never registered");
      return tool;
    },
    get onInput() {
      if (!onInput) throw new Error("input handler was never registered");
      return onInput;
    },
  };
}

describe("bot channel", () => {
  it("registers send_message with a sequential execution mode", () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    expect(h.tool.name).toBe(SEND_MESSAGE_TOOL);
    // Chat is ordered; a parallel batch could interleave two messages.
    expect(h.tool.executionMode).toBe("sequential");
    expect(h.tool.description).toContain("唯一通道");
  });

  it("returns immediately when the model is not waiting for a reply", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    const result = await h.tool.execute("call-1", { text: "在看了" }, undefined, undefined, {} as any);
    expect(result.details).toMatchObject({ delivered: true, waited: false });
  });

  it("rejects an empty message instead of posting nothing", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    const result = await h.tool.execute("call-1", { text: "   " }, undefined, undefined, {} as any);
    expect(result.details).toMatchObject({ delivered: false, reason: "empty-text" });
  });

  it("parks on wait_for_reply until an input arrives, and swallows it", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);

    const pending = h.tool.execute(
      "call-1",
      { text: "改哪个文件？", wait_for_reply: true },
      undefined,
      undefined,
      {} as any
    );

    // Give execute() a tick to arm the waiter before the reply lands.
    await Promise.resolve();
    const inputResult = await h.onInput({ text: "改 README.md" });
    // "handled" is what stops the same words from also queueing as a steer.
    expect(inputResult.action).toBe("handled");

    const result = await pending;
    expect(result.content[0]).toMatchObject({ type: "text", text: "改 README.md" });
    expect(result.details).toMatchObject({ delivered: true, waited: true });
  });

  it("lets unrelated input through when nothing is waiting", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    expect((await h.onInput({ text: "随便说一句" })).action).toBe("continue");
  });

  it("gives up after the reply timeout and tells the model to disclose its assumption", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      createBotChannelFactory({ replyTimeoutMs: 1000 })(h.pi);
      const pending = h.tool.execute(
        "call-1",
        { text: "确认一下？", wait_for_reply: true },
        undefined,
        undefined,
        {} as any
      );
      await vi.advanceTimersByTimeAsync(1001);
      const result = await pending;
      expect(result.details).toMatchObject({ timedOut: true });
      expect(result.content[0].type === "text" && result.content[0].text).toContain("假设");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unblocks when the turn is aborted", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    const controller = new AbortController();
    const pending = h.tool.execute(
      "call-1",
      { text: "还在吗？", wait_for_reply: true },
      controller.signal,
      undefined,
      {} as any
    );
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.details).toMatchObject({ aborted: true });
  });

  it("frees the waiter after a reply so the next input is not swallowed", async () => {
    const h = harness();
    createBotChannelFactory()(h.pi);
    const pending = h.tool.execute(
      "call-1",
      { text: "第一个问题", wait_for_reply: true },
      undefined,
      undefined,
      {} as any
    );
    await Promise.resolve();
    await h.onInput({ text: "答案" });
    await pending;
    expect((await h.onInput({ text: "无关的一句" })).action).toBe("continue");
  });
});
