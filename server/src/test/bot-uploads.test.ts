import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("bot uploads", () => {
  let tmpRoot: string;
  let previousDb: string | undefined;
  let previousWs: string | undefined;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bot-uploads-"));
    previousDb = process.env.DATABASE_PATH;
    previousWs = process.env.WORKSPACE_ROOT;
    process.env.DATABASE_PATH = path.join(tmpRoot, "data", "platform.db");
    process.env.WORKSPACE_ROOT = path.join(tmpRoot, "workspaces");
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousDb === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDb;
    if (previousWs === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = previousWs;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("seeds upload credential and stores a public downloadable file", async () => {
    const { ensureBotUploadCredential, resolveBotUserIdByUploadToken, storeBotUpload, loadBotUpload } =
      await import("../bot/uploads.js");

    const botUserId = "bot-user-1";
    const workspace = path.join(tmpRoot, "workspaces", "Bot-xxxx");
    await fs.mkdir(path.join(workspace, "projects"), { recursive: true });

    const cred = await ensureBotUploadCredential(botUserId, workspace, 3001);
    expect(cred.uploadUrl).toContain("/api/bot/upload");
    expect(cred.token.length).toBeGreaterThan(16);
    expect(await resolveBotUserIdByUploadToken(cred.token)).toBe(botUserId);

    const uploadJson = JSON.parse(
      await fs.readFile(path.join(workspace, ".pi", "upload.json"), "utf-8"),
    );
    expect(uploadJson.token).toBe(cred.token);

    const stored = await storeBotUpload({
      botUserId,
      filename: "hello.txt",
      content: Buffer.from("你好世界"),
      mimeType: "text/plain; charset=utf-8",
    });
    expect(stored.publicPath).toMatch(/^\/api\/public\/uploads\/[a-f0-9]{32}\/hello\.txt$/);

    const loaded = await loadBotUpload(stored.id);
    expect(loaded?.buffer.toString("utf-8")).toBe("你好世界");
    expect(loaded?.meta.filename).toBe("hello.txt");
  });
});
