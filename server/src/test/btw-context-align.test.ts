import { describe, expect, it } from "vitest";
import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";

describe("btw context alignment", () => {
  it("buildSessionContext(entries, leafId) resolves history at a specific leaf", () => {
    const sm = SessionManager.inMemory("/tmp/project");
    const firstUserId = sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    });
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "follow up" }],
      timestamp: 2,
    });

    const atLeaf = sm.buildSessionContext();
    const atFirstUser = buildSessionContext(sm.getEntries(), firstUserId);

    expect(atLeaf.messages).toHaveLength(2);
    expect(atFirstUser.messages).toHaveLength(1);
    expect(atFirstUser.messages[0].role).toBe("user");
  });
});
