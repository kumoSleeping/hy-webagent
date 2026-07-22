import { describe, expect, it } from "vitest";
import { parseSkillInvocation } from "./skillInvocation";

describe("parseSkillInvocation", () => {
  it("hides expanded skill instructions while preserving user arguments", () => {
    expect(parseSkillInvocation(
      '<skill name="bot-group-operations" location="/skills/bot/SKILL.md">\n' +
      'References are relative to /skills/bot.\n\nNever expose secrets.\n</skill>\n\n列出 Bot',
    )).toEqual({ name: "bot-group-operations", userMessage: "列出 Bot" });
  });

  it("rejects ordinary user text", () => {
    expect(parseSkillInvocation("普通消息")).toBeNull();
  });
});
