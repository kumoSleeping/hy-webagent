import { describe, it, expect } from "vitest";
import {
  filterSessionsByQuery,
  filterVisibleSessions,
  indexOfActiveSession,
  nextHistoryIndexAfterDelete,
} from "./historySessions";
import type { SessionSummary } from "../stores/sessionStore";

function session(id: string, title: string): SessionSummary {
  return { id, title, timestamp: "", messageCount: 0 };
}

describe("nextHistoryIndexAfterDelete", () => {
  it("selects the row below after compacting (same index)", () => {
    expect(nextHistoryIndexAfterDelete(10, 43)).toBe(10);
  });

  it("selects the row above when deleting the last entry", () => {
    expect(nextHistoryIndexAfterDelete(43, 43)).toBe(42);
  });

  it("returns 0 for an empty list", () => {
    expect(nextHistoryIndexAfterDelete(0, 0)).toBe(0);
  });
});

describe("indexOfActiveSession", () => {
  it("returns the active session index", () => {
    const sessions = [session("a", "one"), session("b", "two"), session("c", "three")];
    expect(indexOfActiveSession(sessions, "b")).toBe(1);
  });

  it("falls back to 0 when the active session is not in the list", () => {
    expect(indexOfActiveSession([session("a", "one")], "missing")).toBe(0);
  });
});

describe("filterVisibleSessions", () => {
  it("hides empty sessions except the active one", () => {
    const sessions = [
      session("a", "hello"),
      session("b", "(empty)"),
      session("c", "(empty)"),
    ];
    expect(filterVisibleSessions(sessions, "c").map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("filterSessionsByQuery", () => {
  it("returns all sessions when the query is blank", () => {
    const sessions = [session("a", "Alpha"), session("b", "Beta")];
    expect(filterSessionsByQuery(sessions, "  ")).toEqual(sessions);
  });

  it("filters by title substring, case-insensitive", () => {
    const sessions = [session("a", "Fix login bug"), session("b", "Add resume filter")];
    expect(filterSessionsByQuery(sessions, "RESUME").map((s) => s.id)).toEqual(["b"]);
  });

  it("filters attachment-only session titles by filename", () => {
    const sessions = [
      session("a", '<file name="screenshot.png"></file>'),
      session("b", "hello"),
    ];
    expect(filterSessionsByQuery(sessions, "screenshot").map((s) => s.id)).toEqual(["a"]);
  });
});
