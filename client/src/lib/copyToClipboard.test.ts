import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./copyToClipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false for empty text", async () => {
    await expect(copyTextToClipboard("")).resolves.toBe(false);
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard API fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyTextToClipboard("fallback")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
