import { describe, expect, it } from "vitest";
import {
  fitToolbarItemsToBand,
  isElevatedPanel,
  MOBILE_TOOLBAR_ITEMS,
  panelToolbarIndex,
  toolbarItemsForLayout,
} from "./composerLayout";

describe("composerLayout", () => {
  it("uses four toolbar items on mobile", () => {
    expect(toolbarItemsForLayout(true).map((item) => item.id)).toEqual([
      "commands",
      "files",
      "history",
      "new-chat",
    ]);
    expect(MOBILE_TOOLBAR_ITEMS).toHaveLength(4);
  });

  it("elevates only the tree panel", () => {
    expect(isElevatedPanel("commands", true)).toBe(false);
    expect(isElevatedPanel("commands", false)).toBe(false);
    expect(isElevatedPanel("tree", false)).toBe(true);
    expect(isElevatedPanel("tree", true)).toBe(true);
  });

  it("maps panel ids to toolbar indices", () => {
    const mobile = toolbarItemsForLayout(true);
    expect(panelToolbarIndex("files", mobile)).toBe(1);
    expect(panelToolbarIndex("history", mobile)).toBe(2);
  });

  it("trims toolbar items until the bar fits the 80% band", () => {
    const items = toolbarItemsForLayout(true);
    const btn = 50;
    expect(fitToolbarItemsToBand(items, 400, btn).map((i) => i.id)).toEqual([
      "commands",
      "files",
      "history",
      "new-chat",
    ]);
    expect(fitToolbarItemsToBand(items, 199, btn).map((i) => i.id)).toEqual([
      "commands",
      "history",
      "new-chat",
    ]);
    expect(fitToolbarItemsToBand(items, 149, btn).map((i) => i.id)).toEqual(["commands", "new-chat"]);
    expect(fitToolbarItemsToBand(items, 49, btn).map((i) => i.id)).toEqual(["commands"]);
  });

  it("drops model before account on desktop", () => {
    const items = toolbarItemsForLayout(false);
    const btn = 50;
    const trimmed = fitToolbarItemsToBand(items, 300, btn).map((i) => i.id);
    expect(trimmed).not.toContain("model");
    expect(trimmed).toContain("account");
  });
});
