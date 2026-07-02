import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_ADMIN_KEY_PLACEHOLDERS,
  matchesMasterAdminKey,
  resolveAdminKey,
  timingSafeEqualString,
} from "../admin-key.js";

describe("resolveAdminKey", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("returns null when ADMIN_KEY is unset", () => {
    delete process.env.ADMIN_KEY;
    expect(resolveAdminKey(process.env)).toBeNull();
  });

  it("returns trimmed value when ADMIN_KEY is valid", () => {
    process.env.ADMIN_KEY = "  my-strong-master-key-32chars  ";
    expect(resolveAdminKey(process.env)).toBe("my-strong-master-key-32chars");
  });

  it("rejects forbidden placeholders", () => {
    for (const placeholder of FORBIDDEN_ADMIN_KEY_PLACEHOLDERS) {
      process.env.ADMIN_KEY = placeholder;
      expect(() => resolveAdminKey(process.env)).toThrow(/forbidden placeholder/i);
    }
  });

  it("rejects keys shorter than 16 characters", () => {
    process.env.ADMIN_KEY = "short-key";
    expect(() => resolveAdminKey(process.env)).toThrow(/at least 16/i);
  });
});

describe("matchesMasterAdminKey", () => {
  it("returns false when master key is not configured", () => {
    expect(matchesMasterAdminKey("anything", null)).toBe(false);
  });

  it("matches only equal keys", () => {
    const key = "sk-hyw-ValidTestKey01";
    expect(matchesMasterAdminKey(key, key)).toBe(true);
    expect(matchesMasterAdminKey(key + "x", key)).toBe(false);
    expect(matchesMasterAdminKey("wrong-key-value!!", key)).toBe(false);
  });
});

describe("timingSafeEqualString", () => {
  it("compares equal strings", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
  });

  it("rejects different lengths without throwing", () => {
    expect(timingSafeEqualString("a", "ab")).toBe(false);
  });
});
