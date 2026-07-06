import { describe, expect, it } from "vitest";
import {
  adjustToolbarItemsForBand,
  fitToolbarItemsToBand,
  isElevatedPanel,
  MOBILE_TOOLBAR_ITEMS,
  panelToolbarIndex,
  restoreOneToolbarItem,
  toolbarItemsForLayout,
  trimOneToolbarItem,
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

  it("trims only one item per adjust step", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const band = 175;
    const step1 = adjustToolbarItemsForBand(base, base, band, btn);
    expect(step1.map((i) => i.id)).toEqual(["commands", "history", "new-chat"]);
    const step2 = adjustToolbarItemsForBand(step1, base, band, btn);
    expect(step2.map((i) => i.id)).toEqual(["commands", "history", "new-chat"]);
    const tight = 125;
    const step3 = adjustToolbarItemsForBand(step1, base, tight, btn);
    expect(step3.map((i) => i.id)).toEqual(["commands", "new-chat"]);
  });

  it("restores one item when the band widens", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const current = base.filter((i) => i.id !== "files");
    const wider = restoreOneToolbarItem(current, base, 220, btn);
    expect(wider.map((i) => i.id)).toEqual([
      "commands",
      "files",
      "history",
      "new-chat",
    ]);
  });

  it("drops model before account on desktop when stepping repeatedly", () => {
    const base = toolbarItemsForLayout(false);
    const btn = 50;
    const trimmed = fitToolbarItemsToBand(base, 300, btn);
    expect(trimmed).not.toContain("model");
    expect(trimmed.some((i) => i.id === "account")).toBe(true);
  });

  it("trimOne never removes commands", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const onlyCommands = trimOneToolbarItem(
      trimOneToolbarItem(trimOneToolbarItem(base, 40, btn), 40, btn),
      40,
      btn,
    );
    expect(onlyCommands.map((i) => i.id)).toEqual(["commands"]);
  });
});
