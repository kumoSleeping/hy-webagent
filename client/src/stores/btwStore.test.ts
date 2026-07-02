import { describe, expect, it } from "vitest";
import { useBtwStore } from "./btwStore";

describe("useBtwStore", () => {
  it("streams a turn from start through finish", () => {
    useBtwStore.getState().bindSession("sess-a");
    useBtwStore.getState().clear();
    const id = useBtwStore.getState().startTurn("hello");
    useBtwStore.getState().appendDelta(id, "world");
    useBtwStore.getState().finishTurn(id, "world");
    const turn = useBtwStore.getState().turns.find((t) => t.id === id);
    expect(turn?.answer).toBe("world");
    expect(turn?.pending).toBe(false);
  });

  it("replaces the previous turn when starting a new question", () => {
    useBtwStore.setState({ boundSessionId: null, bySession: {}, turns: [], activeTurnId: null });
    useBtwStore.getState().bindSession("sess-a");
    useBtwStore.getState().startTurn("first");
    useBtwStore.getState().startTurn("second");
    expect(useBtwStore.getState().turns).toHaveLength(1);
    expect(useBtwStore.getState().turns[0]?.question).toBe("second");
  });

  it("reuses an in-flight turn for the same question", () => {
    useBtwStore.setState({ boundSessionId: null, bySession: {}, turns: [], activeTurnId: null });
    const first = useBtwStore.getState().startTurn("same");
    const second = useBtwStore.getState().ensureTurn("same");
    expect(second).toBe(first);
    expect(useBtwStore.getState().turns).toHaveLength(1);
  });

  it("binds turns per session and clears pending on switch", () => {
    useBtwStore.setState({ boundSessionId: null, bySession: {}, turns: [], activeTurnId: null });

    useBtwStore.getState().bindSession("sess-a");
    useBtwStore.getState().startTurn("q1");

    useBtwStore.getState().bindSession("sess-b");
    expect(useBtwStore.getState().turns).toEqual([]);

    useBtwStore.getState().bindSession("sess-a");
    const turn = useBtwStore.getState().turns[0];
    expect(turn?.question).toBe("q1");
    expect(turn?.pending).toBe(false);
    expect(turn?.error).toMatch(/session changed/i);
  });
});
