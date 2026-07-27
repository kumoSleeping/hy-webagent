import { describe, expect, it } from "vitest";
import { formatSessionStats } from "./sessionStatsFormat";

describe("formatSessionStats", () => {
  it("formats tokens, cost, and contextUsage for the session panel", () => {
    const rows = formatSessionStats({
      sessionFile: "/opt/hy-webagent/workspaces/default-alice/sessions/foo.jsonl",
      sessionId: "019fa3e4-8941-7a15-8c36-a92605ad37ab",
      userMessages: 3,
      assistantMessages: 13,
      toolCalls: 19,
      toolResults: 19,
      totalMessages: 35,
      tokens: { input: 226049, output: 5932, cacheRead: 12000, cacheWrite: 0 },
      cost: 0.10881933900000001,
      contextUsage: { tokens: 242495, contextWindow: 256000, percent: 94.7 },
    });
    expect(rows).toBeDefined();
    const byKey = Object.fromEntries(rows!.map((r) => [r.key, r]));
    expect(byKey.sessionFile.label).toBe("File");
    expect(byKey.sessionFile.detail).toContain("foo.jsonl");
    expect(byKey.sessionFile.titleAttr).toContain("/opt/hy-webagent/");
    expect(byKey.sessionId.detail).toMatch(/019fa3e4…/);
    expect(byKey.tokens.detail).toContain("↑");
    expect(byKey.tokens.detail).toContain("↓");
    expect(byKey.cost.detail).toBe("$0.109");
    expect(byKey.contextUsage.detail).toMatch(/94\.7%/);
    expect(byKey.userMessages.detail).toBe("3");
  });

  it("returns undefined for non-objects", () => {
    expect(formatSessionStats(null)).toBeUndefined();
    expect(formatSessionStats("x")).toBeUndefined();
  });
});
