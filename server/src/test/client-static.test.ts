import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveClientDistDir } from "../client-static.js";

describe("client-static", () => {
  it("prefers cwd/public when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-static-"));
    const prev = process.cwd();
    try {
      const dist = path.join(root, "public");
      await fs.mkdir(dist, { recursive: true });
      await fs.writeFile(path.join(dist, "index.html"), "<!doctype html>");
      process.chdir(root);
      const resolved = resolveClientDistDir();
      expect(resolved).toBeTruthy();
      expect(path.basename(resolved!)).toBe("public");
    } finally {
      process.chdir(prev);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to repo client/dist when cwd has no build", () => {
    const resolved = resolveClientDistDir();
    expect(resolved).toBeTruthy();
    expect(resolved!.endsWith(`${path.sep}client${path.sep}dist`)).toBe(true);
  });
});
