import { describe, expect, it } from "vitest";

function isFileDownloadHref(href?: string): boolean {
  if (!href) return false;
  try {
    const pathname = href.startsWith("http")
      ? new URL(href).pathname
      : new URL(href, "http://local").pathname;
    return pathname === "/api/files/download";
  } catch {
    return false;
  }
}

describe("download link detection", () => {
  it("matches workspace download API paths", () => {
    expect(isFileDownloadHref("/api/files/download?path=report.pdf")).toBe(true);
    expect(isFileDownloadHref("http://localhost:5173/api/files/download?path=a.zip")).toBe(true);
  });

  it("ignores other links", () => {
    expect(isFileDownloadHref("/api/files/read?path=a.md")).toBe(false);
    expect(isFileDownloadHref("https://example.com/file.pdf")).toBe(false);
    expect(isFileDownloadHref(undefined)).toBe(false);
  });
});
