import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotRepository } from "../bot/repository.js";
import { AuthSystem } from "../auth.js";

describe("BotRepository", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.API_KEY_LOOKUP_SECRET;
  });

  function setup() {
    process.env.API_KEY_LOOKUP_SECRET = "bot-repository-test";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bot-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "platform.db");
    return { dbPath, bots: new BotRepository(dbPath), auth: new AuthSystem({ databasePath: dbPath }) };
  }

  it("persists bot channels, sessions, and reply message links", async () => {
    const { dbPath, bots, auth } = setup();
    const { user } = await auth.createUser(undefined, "Kaguya Bot", { username: "bot-kgy", role: "bot" });
    const now = Date.now();
    bots.createAccount({ userId: user.userId, slug: "kgy", displayName: "Kaguya Bot", enabled: true, createdAt: now, updatedAt: now });
    bots.upsertChannel({ botUserId: user.userId, channelId: "666808414", displayName: "Test group", platform: "qq", metadata: null });
    bots.createSession({ piSessionId: "pi-1", botUserId: user.userId, channelId: "666808414",
      sourceMessageId: "incoming-1", title: "Inspect project", status: "running", createdAt: now, updatedAt: now });
    bots.linkMessage({ botUserId: user.userId, channelId: "666808414", messageId: "bot-reply-1", piSessionId: "pi-1", direction: "outgoing" });
    bots.close();

    const reopened = new BotRepository(dbPath);
    expect(reopened.findAccountBySlug("KGY")?.userId).toBe(user.userId);
    expect(reopened.listChannels(user.userId)[0]?.channelId).toBe("666808414");
    expect(reopened.listSessions(user.userId, "666808414")[0]?.title).toBe("Inspect project");
    expect(reopened.resolveMessage(user.userId, "666808414", "bot-reply-1")).toBe("pi-1");
    reopened.close();
  });

  it("keeps bot accounts out of the administrator role", async () => {
    const { auth, bots } = setup();
    const { plainKey } = await auth.createUser(undefined, "Worker Bot", { username: "bot-worker", role: "bot" });
    const session = await auth.login(plainKey);
    expect(session.role).toBe("bot");
    expect(auth.hasAdminUser()).toBe(false);
    bots.close();
  });

  it("keeps group sessions scoped to the owning bot", async () => {
    const { auth, bots } = setup();
    const { user: botUser } = await auth.createUser(undefined, "Group Bot", { role: "bot" });
    const now = Date.now();
    bots.createAccount({ userId: botUser.userId, slug: "group-bot", displayName: "Group Bot", enabled: true, createdAt: now, updatedAt: now });
    bots.upsertChannel({ botUserId: botUser.userId, channelId: "666808414", displayName: "Saved group", platform: "qq", metadata: null });
    bots.createSession({ piSessionId: "session-latest", botUserId: botUser.userId, channelId: "666808414",
      sourceMessageId: null, title: "Latest", status: "idle", createdAt: now, updatedAt: now });

    expect(bots.findChannel(botUser.userId, "666808414")?.displayName).toBe("Saved group");
    expect(bots.listSessions(botUser.userId, "666808414")[0]?.piSessionId).toBe("session-latest");
    bots.close();
  });
});
