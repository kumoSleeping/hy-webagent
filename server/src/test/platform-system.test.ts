import { describe, expect, it } from "vitest";
import {
  PLATFORM_RULES_MARKER,
  assertPlatformRulesLoaded,
  buildPlatformAppendSections,
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
    expect(text).not.toContain("/dream");
    expect(text).toContain("会话索引");
    expect(text).toContain("不要记这些");
    expect(text).toContain("/api/files/download");
  });

  it("append sections include platform rules and security layer", async () => {
    resetPlatformSystemCacheForTests();
    const sections = await buildPlatformAppendSections();
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0]).toContain(PLATFORM_RULES_MARKER);
    expect(sections.some((s) => s.includes("Security Rules"))).toBe(true);
  });

  it("assertPlatformRulesLoaded rejects prompts without the marker", () => {
    expect(() => assertPlatformRulesLoaded("hello")).toThrow(/Platform rules/);
    expect(() => assertPlatformRulesLoaded(`prefix ${PLATFORM_RULES_MARKER} suffix`)).not.toThrow();
  });
});
