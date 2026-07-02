import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { seedSessionFromBranch } from "../pi/btw-branch-seed.js";

describe("seedSessionFromBranch", () => {
  it("replays messages and compaction into in-memory context", () => {
    const source = SessionManager.inMemory("/tmp/project");
    const userId = source.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    });
    source.appendMessage({
      role: "user",
      content: [{ type: "text", text: "follow up" }],
      timestamp: 2,
    });
    source.appendCompaction("summary", userId, 100);

    const branch = source.getBranch();
    const target = SessionManager.inMemory("/tmp/project");
    seedSessionFromBranch(target, branch);

    const ctx = target.buildSessionContext();
    expect(ctx.messages.length).toBeGreaterThan(0);
    expect(ctx.messages.some((m) => m.role === "user" || m.role === "compactionSummary")).toBe(true);
  });
});
