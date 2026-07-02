import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { AuthSystem, generateApiKey } from "../auth.js";
import { computeApiKeyLookup, resetApiKeyLookupSecretForTests } from "../api-key-lookup.js";
import { UsageRecorder } from "../usage/recorder.js";
import { resetUserRepositoryForTests } from "../db/index.js";

describe("AuthSystem admin roles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
    resetUserRepositoryForTests();
    resetApiKeyLookupSecretForTests();
    delete process.env.API_KEY_LOOKUP_SECRET;
  });

  function makeAuth(): AuthSystem {
    process.env.API_KEY_LOOKUP_SECRET = "test-auth-secret";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-"));
    tempDirs.push(dir);
    return new AuthSystem({ databasePath: path.join(dir, "platform.db") });
  }

  it("creates admin user with unlimited budget", async () => {
    const auth = makeAuth();
    const { user } = await auth.createUser(undefined, "Admin", {
      role: "admin",
      username: "admin",
    });
    expect(user.role).toBe("admin");
    expect(user.budgetUsd).toBeNull();
    expect(auth.hasBudget(user.userId)).toBe(true);
  });

  it("upgrades user to admin with unlimited budget", async () => {
    const auth = makeAuth();
    const key = generateApiKey();
    const { user } = await auth.createUser(key, "Alice", { username: "alice" });
    expect(user.role).toBe("user");
    expect(user.budgetUsd).toBe(2);

    const updated = auth.updateUser(user.userId, { role: "admin" });
    expect(updated.role).toBe("admin");
    expect(updated.budgetUsd).toBeNull();
  });

  it("blocks demoting the last admin", async () => {
    const auth = makeAuth();
    const { user } = await auth.createUser(generateApiKey(), "Admin", { role: "admin" });
    expect(() => auth.updateUser(user.userId, { role: "user" })).toThrow(/last admin/i);
  });

  it("verifyAdminApiKey accepts only admin keys", async () => {
    const auth = makeAuth();
    const adminKey = generateApiKey();
    const userKey = generateApiKey();
    await auth.createUser(adminKey, "Admin", { role: "admin" });
    await auth.createUser(userKey, "Bob", { username: "bob" });

    expect(await auth.verifyAdminApiKey(adminKey)).not.toBeNull();
    expect(await auth.verifyAdminApiKey(userKey)).toBeNull();
  });

  it("stores plain API key in database on createUser", async () => {
    const auth = makeAuth();
    const { user, plainKey } = await auth.createUser(undefined, "Admin", { role: "admin" });
    expect(auth.getStoredApiKey(user.userId)).toBe(plainKey);
    expect(user.apiKeyLookup).toBe(computeApiKeyLookup(plainKey));
  });

  it("findUserByApiKey uses lookup index with single bcrypt", async () => {
    const auth = makeAuth();
    const key = generateApiKey();
    await auth.createUser(key, "Bob", { username: "bob" });
    await auth.createUser(generateApiKey(), "Carol", { username: "carol" });

    const compareSpy = vi.spyOn(bcrypt, "compare");
    compareSpy.mockClear();
    const found = await auth.findUserByApiKey(key);
    expect(found?.username).toBe("bob");
    expect(compareSpy).toHaveBeenCalledTimes(1);
    compareSpy.mockRestore();
  });
});

describe("UsageRecorder", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records daily usage by model", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-usage-"));
    tempDirs.push(dir);
    const recorder = new UsageRecorder(dir);
    const date = "2026-07-02";

    recorder.record({
      userId: "u1",
      displayName: "alice",
      provider: "anthropic",
      model: "claude-sonnet-4",
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0.01,
      source: "chat",
      date,
    });
    recorder.record({
      userId: "u1",
      displayName: "alice",
      provider: "openai",
      model: "gpt-4o",
      input: 20,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0.002,
      source: "subagent",
      date,
    });

    const daily = recorder.getDaily("u1", date);
    expect(daily?.totals.input).toBe(120);
    expect(daily?.totals.output).toBe(60);
    expect(daily?.totals.turns).toBe(2);
    expect(daily?.models["anthropic/claude-sonnet-4"]?.input).toBe(100);
    expect(daily?.models["openai/gpt-4o"]?.turns).toBe(1);
  });
});
