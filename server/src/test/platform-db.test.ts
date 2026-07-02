import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openUserRepository } from "../db/user-repository.js";
import { generateApiKey, AuthSystem } from "../auth.js";

describe("UserRepository", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-db-"));
    tempDirs.push(dir);
    return openUserRepository(path.join(dir, "platform.db"));
  }

  it("persists users and stored api keys", async () => {
    process.env.API_KEY_LOOKUP_SECRET = "test-db-secret";
    const repo = makeRepo();
    const auth = new AuthSystem({ databasePath: path.join(tempDirs.at(-1)!, "platform.db") });
    const { user, plainKey } = await auth.createUser(undefined, "Admin", { role: "admin", username: "admin" });

    expect(repo.findById(user.userId)?.displayName).toBe("Admin");
    expect(repo.getStoredApiKey(user.userId)).toBe(plainKey);
    repo.close();
  });

  it("adds api_key_lookup column to pre-existing databases", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-db-old-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "platform.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        api_key_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        token_quota INTEGER NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        budget_usd REAL,
        budget_used_usd REAL NOT NULL DEFAULT 0,
        system_prompt TEXT,
        workspace_dir TEXT
      );
      CREATE TABLE stored_api_keys (
        user_id TEXT PRIMARY KEY,
        api_key_plain TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy.close();

    expect(() => openUserRepository(dbPath).close()).not.toThrow();
    const probe = new Database(dbPath);
    const columns = (probe.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    probe.close();
    expect(columns).toContain("api_key_lookup");
  });

  it("migrates legacy users.json when database is empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-db-mig-"));
    tempDirs.push(dir);
    const jsonPath = path.join(dir, "users.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify([
        {
          userId: "legacy-1",
          apiKeyHash: "hash",
          displayName: "Legacy",
          username: "legacy",
          role: "user",
          createdAt: 1,
          tokensUsed: 0,
          budgetUsd: 2,
          budgetUsedUsd: 0,
          workspaceDir: "legacy-abc",
        },
      ])
    );

    const repo = openUserRepository(path.join(dir, "platform.db"));
    const count = repo.migrateFromJson(jsonPath);
    expect(count).toBe(1);
    expect(repo.findByUsername("legacy")?.userId).toBe("legacy-1");
    repo.close();
  });
});

describe("generateApiKey", () => {
  it("produces sk-hyw- prefixed keys", () => {
    expect(generateApiKey().startsWith("sk-hyw-")).toBe(true);
  });
});
