import { describe, expect, it } from "vitest";
import {
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

  it("elevates composer panels on mobile but not desktop", () => {
    expect(isElevatedPanel("commands", true)).toBe(true);
    expect(isElevatedPanel("commands", false)).toBe(false);
    expect(isElevatedPanel("tree", false)).toBe(true);
  });

  it("maps panel ids to mobile toolbar indices", () => {
    expect(panelToolbarIndex("files", true)).toBe(1);
    expect(panelToolbarIndex("history", true)).toBe(2);
  });
});
