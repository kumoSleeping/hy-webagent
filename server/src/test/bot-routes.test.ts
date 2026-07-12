import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AuthSystem } from "../auth.js";
import { BotRepository } from "../bot/repository.js";
import { createPublicBotRouter, createSavedGroupRouter } from "../routes/bot.js";

describe("group routes", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    delete process.env.API_KEY_LOOKUP_SECRET;
  });

  it("serves channel/session URLs publicly and saves groups per logged-in user", async () => {
    process.env.API_KEY_LOOKUP_SECRET = "bot-route-test";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bot-route-"));
    const dbPath = path.join(dir, "platform.db");
    const visibleRoot = path.join(dir, "viewer-workspace", "projects");
    const auth = new AuthSystem({ databasePath: dbPath });
    const bots = new BotRepository(dbPath);
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    cleanups.push(() => bots.close());
    cleanups.push(() => auth.dispose());

    const { user: botUser } = await auth.createUser(undefined, "Kaguya", { role: "bot" });
    const { plainKey: viewerKey } = await auth.createUser(undefined, "Viewer");
    const viewerSession = await auth.login(viewerKey);
    const now = Date.now();
    bots.createAccount({ userId: botUser.userId, slug: "kgy", displayName: "Kaguya", enabled: true, createdAt: now, updatedAt: now });
    bots.upsertChannel({ botUserId: botUser.userId, channelId: "666808414", displayName: "Test group", platform: "qq", metadata: null });
    bots.createSession({ piSessionId: "019f1104-1cf9-7d93-a733-eb4e4f5be525", botUserId: botUser.userId,
      channelId: "666808414", sourceMessageId: null, title: "Latest", status: "idle", createdAt: now, updatedAt: now });

    const app = express();
    app.use(express.json());
    app.use("/api/public/bots", createPublicBotRouter(bots, { isAgentRunning: () => false } as any));
    app.use("/api/groups", createSavedGroupRouter(auth, bots, { getVisibleRoot: () => visibleRoot } as any));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => server.close());
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const base = `http://127.0.0.1:${address.port}`;

    const publicResponse = await fetch(`${base}/api/public/bots/channels/666808414/sessions/019f1104-1cf9-7d93-a733-eb4e4f5be525`);
    expect(publicResponse.status).toBe(200);
    const dashboard = await publicResponse.json() as any;
    expect(dashboard.sessions[0].viewUrl).toBe("/kgy/666808414");

    const savedResponse = await fetch(`${base}/api/groups`, {
      method: "POST",
      headers: { Authorization: `Bearer ${viewerSession.sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ botSlug: "kgy", channelId: "666808414" }),
    });
    expect(savedResponse.status).toBe(201);
    const listResponse = await fetch(`${base}/api/groups`, {
      headers: { Authorization: `Bearer ${viewerSession.sessionId}` },
    });
    const list = await listResponse.json() as any;
    expect(list.groups[0].viewUrl).toBe("/kgy/666808414");
    expect(list.configFile).toBe("saved-groups.json");
    expect(JSON.parse(fs.readFileSync(path.join(visibleRoot, "saved-groups.json"), "utf-8"))).toEqual({
      version: 1,
      groups: [{ botSlug: "kgy", channelId: "666808414" }],
    });
  }, 15_000);
});
