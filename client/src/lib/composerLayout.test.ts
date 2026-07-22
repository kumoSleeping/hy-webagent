import { describe, expect, it } from "vitest";
import {
  adjustToolbarItemsForBand,
  fitToolbarItemsToBand,
  isElevatedPanel,
  MOBILE_TOOLBAR_ITEMS,
  GROUP_PREVIEW_TOOLBAR_ITEMS,
  panelToolbarIndex,
  restoreOneToolbarItem,
  toolbarItemsForLayout,
  trimOneToolbarItem,
} from "./composerLayout";

describe("composerLayout", () => {
  it("limits group preview to the five read-only navigation surfaces", () => {
    expect(GROUP_PREVIEW_TOOLBAR_ITEMS.map((item) => item.id)).toEqual([
      "model",
      "history",
      "files",
      "account",
      "return-chat",
    ]);
  });

  it("uses the full toolbar pool on mobile", () => {
    expect(toolbarItemsForLayout(true).map((item) => item.id)).toEqual([
      "commands",
      "model",
      "account",
      "tree",
      "files",
      "history",
      "new-chat",
    ]);
    expect(MOBILE_TOOLBAR_ITEMS).toHaveLength(7);
  });

  it("elevates only the tree panel", () => {
    expect(isElevatedPanel("commands", true)).toBe(false);
    expect(isElevatedPanel("commands", false)).toBe(false);
    expect(isElevatedPanel("tree", false)).toBe(true);
    expect(isElevatedPanel("tree", true)).toBe(true);
  });

  it("maps panel ids to toolbar indices", () => {
    const mobile = toolbarItemsForLayout(true);
    expect(panelToolbarIndex("files", mobile)).toBe(4);
    expect(panelToolbarIndex("history", mobile)).toBe(5);
  });

  it("trims only one item per adjust step in mobile order", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const band = 175;
    const step1 = adjustToolbarItemsForBand(base, base, band, btn);
    // tree is dropped first so model remains visible on typical phones.
    expect(step1.map((i) => i.id)).toEqual([
      "commands",
      "model",
      "account",
      "files",
      "history",
      "new-chat",
    ]);
    const step2 = adjustToolbarItemsForBand(step1, base, band, btn);
    // account is dropped next; model ranks after commands/files/history.
    expect(step2.map((i) => i.id)).toEqual([
      "commands",
      "model",
      "files",
      "history",
      "new-chat",
    ]);
    const tight = 125;
    const step3 = adjustToolbarItemsForBand(step1, base, tight, btn);
    // One more step from step1 drops account.
    expect(step3.map((i) => i.id)).toEqual([
      "commands",
      "model",
      "files",
      "history",
      "new-chat",
    ]);
  });

  it("keeps model and removes tree at a common six-slot phone width", () => {
    const fitted = fitToolbarItemsToBand(toolbarItemsForLayout(true), 300, 50);
    expect(fitted.map((item) => item.id)).toEqual([
      "commands",
      "model",
      "account",
      "files",
      "history",
      "new-chat",
    ]);
  });

  it("restores one item when the band widens", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const current = base.filter((i) => i.id !== "files" && i.id !== "history");
    const wider = restoreOneToolbarItem(current, base, 300, btn);
    // history is restored before files (reverse trim order).
    expect(wider.map((i) => i.id)).toEqual([
      "commands",
      "model",
      "account",
      "tree",
      "history",
      "new-chat",
    ]);
  });

  it("drops tree before account when stepping repeatedly", () => {
    const base = toolbarItemsForLayout(false);
    const btn = 50;
    const trimmed = fitToolbarItemsToBand(base, 300, btn);
    expect(trimmed).not.toContain("tree");
    expect(trimmed.some((i) => i.id === "account")).toBe(true);
  });

  it("trimOne never removes commands", () => {
    const base = toolbarItemsForLayout(true);
    const btn = 50;
    const onlyCommands = trimOneToolbarItem(
      trimOneToolbarItem(
        trimOneToolbarItem(
          trimOneToolbarItem(
            trimOneToolbarItem(
              trimOneToolbarItem(base, 40, btn),
              40,
              btn,
            ),
            40,
            btn,
          ),
          40,
          btn,
        ),
        40,
        btn,
      ),
      40,
      btn,
    );
    expect(onlyCommands.map((i) => i.id)).toEqual(["commands"]);
  });
});
