import { describe, expect, it } from "vitest";
import { submitBtwQuestion } from "./btwAsk";
import { useBtwStore } from "../stores/btwStore";
import { useComposerPanelStore } from "../stores/composerPanelStore";

describe("submitBtwQuestion", () => {
  it("creates a pending turn before sending", () => {
    useBtwStore.setState({ boundSessionId: null, bySession: {}, turns: [], activeTurnId: null });
    useComposerPanelStore.setState({ panel: null, btwPanelSuppressed: false, previewOpen: false });

    submitBtwQuestion("hello?", () => true);

    expect(useComposerPanelStore.getState().panel).toBe("btw");
    const turn = useBtwStore.getState().turns[0];
    expect(turn?.question).toBe("hello?");
    expect(turn?.pending).toBe(true);
    expect(turn?.answer).toBe("");
  });
});
