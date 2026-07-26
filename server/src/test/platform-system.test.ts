import { describe, expect, it } from "vitest";
import {
  PLATFORM_BOT_RULES_MARKER,
  PLATFORM_RULES_MARKER,
  assertBotRulesLoaded,
  assertPlatformRulesLoaded,
  buildPlatformAppendSections,
  buildResourceLoaderOptionsForSession,
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
    expect(text).toContain("```summary");
    expect(text).toContain("百科式");
    expect(text).toContain("emoji");
    expect(text).not.toMatch(/cwd\s*为/i);
    // 聊天附件一节明确图片落盘位置「Pictures/(相对 projects/)」,
    // 旧的「正文不得出现 projects/」全域断言随之作废,收窄为不暴露 cwd。
    expect(text).toContain("Pictures/");
  });

  it("loads SYSTEM_BOT.md with bot upload rules", async () => {
    resetPlatformSystemCacheForTests();
    const text = await loadPlatformBotSystemMd();
    expect(text).toContain(PLATFORM_BOT_RULES_MARKER);
    expect(text).toContain("不要在工作区保存任何文件");
    expect(text).toContain("uploadUrl");
    expect(text).toContain("upload.json");
    expect(text).toContain("X-Bot-Upload-Token");
    expect(text).toContain("```summary");
  });

  it("SYSTEM_BOT.md states the send_message contract", async () => {
    resetPlatformSystemCacheForTests();
    const text = await loadPlatformBotSystemMd();
    expect(text).toContain("send_message");
    expect(text).toContain("这一条通道");
    expect(text).toContain("wait_for_reply");
    expect(text).toContain('kind="brief"');
    expect(text).toContain('kind="final"');
  });

  it("hands the send_message channel to bot sessions only", () => {
    const web = buildResourceLoaderOptionsForSession("/tmp/ws", "/tmp/ws/projects", true, false);
    const bot = buildResourceLoaderOptionsForSession("/tmp/ws", "/tmp/ws/projects", true, true);
    // Both keep the sandbox; only the bot session gets the extra channel.
    expect(web.extensionFactories).toHaveLength(1);
    expect(bot.extensionFactories).toHaveLength(2);
  });

  it("still gives a bot session the channel with the sandbox disabled", () => {
    const admin = buildResourceLoaderOptionsForSession("/tmp/ws", "/tmp/ws/projects", false, true);
    expect(admin.extensionFactories).toHaveLength(1);
  });

  it("adds no extensions for a sandbox-free web session", () => {
    const plain = buildResourceLoaderOptionsForSession("/tmp/ws", "/tmp/ws/projects", false, false);
    expect(plain.extensionFactories).toBeUndefined();
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
