import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findSessionFilePath } from "../pi/session-files.js";

describe("findSessionFilePath", () => {
  it("finds Pi session files by header id embedded in filename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-sessions-"));
    const sessionId = "019f1104-1cf9-7d93-a733-eb4e4f5be525";
    const filename = `2024-01-01T00-00-00-000Z_${sessionId}.jsonl`;
    await writeFile(
      join(dir, filename),
      JSON.stringify({ type: "session", id: sessionId, version: 3, cwd: "/tmp", timestamp: "" }) + "\n"
    );

    const found = await findSessionFilePath(dir, sessionId);
    expect(found).toBe(join(dir, filename));
  });

  it("returns null when session id is not on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-sessions-"));
    expect(await findSessionFilePath(dir, "missing-id")).toBeNull();
  });

  it("returns null when sessions directory does not exist", async () => {
    const dir = join(tmpdir(), "does-not-exist-" + Date.now());
    expect(await findSessionFilePath(dir, "any")).toBeNull();
  });
});
