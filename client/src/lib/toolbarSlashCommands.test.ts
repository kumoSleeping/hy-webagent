import { describe, it, expect } from "vitest";
import { resolveToolbarSlash } from "./toolbarSlashCommands";

describe("resolveToolbarSlash", () => {
  it("maps bare toolbar slash commands to panels", () => {
    expect(resolveToolbarSlash("/resume")).toEqual({ panel: "history", fetchSessions: true });
    expect(resolveToolbarSlash("/files")).toEqual({ panel: "files" });
    expect(resolveToolbarSlash("/user")).toEqual({ panel: "account" });
    expect(resolveToolbarSlash("/account")).toEqual({ panel: "account" });
    expect(resolveToolbarSlash("/tree")).toEqual({ panel: "tree", treeMode: "tree" });
    expect(resolveToolbarSlash("/fork")).toEqual({ panel: "tree", treeMode: "fork" });
    expect(resolveToolbarSlash("/model")).toEqual({ panel: "model" });
  });

  it("ignores slash commands with arguments", () => {
    expect(resolveToolbarSlash("/name foo")).toBeNull();
  });
});
