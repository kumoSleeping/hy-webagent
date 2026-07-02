import { describe, it, expect } from "vitest";
import { resolveToolbarSlash } from "./toolbarSlashCommands";

describe("resolveToolbarSlash", () => {
  it("maps bare toolbar slash commands to panels", () => {
    expect(resolveToolbarSlash("/resume")).toEqual({ panel: "history", fetchSessions: true });
    expect(resolveToolbarSlash("/tree")).toEqual({ panel: "tree", treeMode: "tree" });
    expect(resolveToolbarSlash("/fork")).toEqual({ panel: "tree", treeMode: "fork" });
    expect(resolveToolbarSlash("/btw")).toEqual({ panel: "btw" });
  });

  it("ignores slash commands with arguments", () => {
    expect(resolveToolbarSlash("/btw what is this")).toBeNull();
    expect(resolveToolbarSlash("/name foo")).toBeNull();
  });
});
