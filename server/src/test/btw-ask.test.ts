import { describe, expect, it, vi } from "vitest";
import { emitBtwAgentEvent } from "../pi/btw-ask.js";

describe("emitBtwAgentEvent", () => {
  it("maps text deltas to btw:text_delta", () => {
    const emit = vi.fn();
    emitBtwAgentEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hi" },
      } as any,
      emit
    );
    expect(emit).toHaveBeenCalledWith("btw:text_delta", { delta: "hi" });
  });

  it("maps thinking deltas to btw:thinking_delta", () => {
    const emit = vi.fn();
    emitBtwAgentEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
      } as any,
      emit
    );
    expect(emit).toHaveBeenCalledWith("btw:thinking_delta", { delta: "hmm" });
  });

  it("maps agent lifecycle events", () => {
    const emit = vi.fn();
    emitBtwAgentEvent({ type: "agent_start" } as any, emit);
    emitBtwAgentEvent({ type: "agent_end" } as any, emit);
    expect(emit).toHaveBeenCalledWith("btw:agent_start", {});
    expect(emit).toHaveBeenCalledWith("btw:agent_end", {});
  });
});
