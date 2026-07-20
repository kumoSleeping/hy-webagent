import { describe, expect, it } from "vitest";
import {
  PLATFORM_BOT_RULES_MARKER,
  PLATFORM_RULES_MARKER,
  assertBotRulesLoaded,
  assertPlatformRulesLoaded,
  buildPlatformAppendSections,
  loadPlatformBotSystemMd,
  loadPlatformSystemMd,
  resetPlatformSystemCacheForTests,
} from "../pi/platform-system.js";

describe("platform-system", () => {
  it("loads SYSTEM.md with the platform marker", async () => {
    resetPlatformSystemCacheForTests();
    const text = await loadPlatformSystemMd();
    expect(text).toContain(PLATFORM_RULES_MARKER);
    expect(text).toContain("Memories.md");
    expect(text).toContain("../.pi/sessions/");
    expect(text).toContain("会话索引");
    expect(text).toContain("不要记这些");
    expect(text).toContain("/api/files/download");
    expect(text).not.toMatch(/cwd\s*为/i);
    expect(text).not.toContain("projects/");
  });

  it("loads SYSTEM_BOT.md with bot upload rules", async () => {
    resetPlatformSystemCacheForTests();
    const text = await loadPlatformBotSystemMd();
    expect(text).toContain(PLATFORM_BOT_RULES_MARKER);
    expect(text).toContain("不要在工作区保存任何文件");
    expect(text).toContain("uploadUrl");
    expect(text).toContain("upload.json");
    expect(text).toContain("X-Bot-Upload-Token");
  });

  it("append sections include platform rules and security layer", async () => {
    resetPlatformSystemCacheForTests();
    const sections = await buildPlatformAppendSections();
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0]).toContain(PLATFORM_RULES_MARKER);
    expect(sections.some((s) => s.includes("Security Rules"))).toBe(true);
    expect(sections.some((s) => s.includes(PLATFORM_BOT_RULES_MARKER))).toBe(false);
  });

  it("append sections can include bot rules", async () => {
    resetPlatformSystemCacheForTests();
    const sections = await buildPlatformAppendSections(true);
    expect(sections.some((s) => s.includes(PLATFORM_BOT_RULES_MARKER))).toBe(true);
  });

  it("assertPlatformRulesLoaded rejects prompts without the marker", () => {
    expect(() => assertPlatformRulesLoaded("hello")).toThrow(/Platform rules/);
    expect(() => assertPlatformRulesLoaded(`prefix ${PLATFORM_RULES_MARKER} suffix`)).not.toThrow();
  });

  it("assertBotRulesLoaded rejects prompts without the bot marker", () => {
    expect(() => assertBotRulesLoaded("hello")).toThrow(/Bot rules/);
    expect(() => assertBotRulesLoaded(`prefix ${PLATFORM_BOT_RULES_MARKER} suffix`)).not.toThrow();
  });
});
