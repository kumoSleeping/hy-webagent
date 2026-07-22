import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { UserAccount } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  api_key_lookup TEXT,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  token_quota INTEGER NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL,
  budget_used_usd REAL NOT NULL DEFAULT 0,
  system_prompt TEXT,
  workspace_dir TEXT,
  model_template_id TEXT,
  model_allow_json TEXT
);

CREATE TABLE IF NOT EXISTS stored_api_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  api_key_plain TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
`;

export interface UserRow {
  user_id: string;
  api_key_hash: string;
  api_key_lookup: string | null;
  display_name: string;
  username: string;
  role: string;
  created_at: number;
  token_quota: number;
  tokens_used: number;
  budget_usd: number | null;
  budget_used_usd: number;
  system_prompt: string | null;
  workspace_dir: string | null;
  model_template_id: string | null;
  model_allow_json: string | null;
}

function parseModelAllowJson(raw: string | null): UserAccount["modelAllow"] {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return undefined;
  return parsed as UserAccount["modelAllow"];
}

function serializeModelAllowJson(value: UserAccount["modelAllow"]): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function rowToUser(row: UserRow): UserAccount {
  return {
    userId: row.user_id,
    apiKeyHash: row.api_key_hash,
    apiKeyLookup: row.api_key_lookup ?? undefined,
    displayName: row.display_name,
    username: row.username,
    role: row.role as UserAccount["role"],
    createdAt: row.created_at,
    tokensUsed: row.tokens_used,
    budgetUsd: row.budget_usd,
    budgetUsedUsd: row.budget_used_usd,
    systemPrompt: row.system_prompt ?? undefined,
    workspaceDir: row.workspace_dir ?? undefined,
    modelTemplateId: row.model_template_id ?? undefined,
    modelAllow: parseModelAllowJson(row.model_allow_json),
  };
}

function userToRow(user: UserAccount): UserRow {
  return {
    user_id: user.userId,
    api_key_hash: user.apiKeyHash,
    api_key_lookup: user.apiKeyLookup ?? null,
    display_name: user.displayName,
    username: user.username ?? user.displayName,
    role: user.role ?? "user",
    created_at: user.createdAt,
    token_quota: 0,
    tokens_used: user.tokensUsed,
    budget_usd: user.budgetUsd,
    budget_used_usd: user.budgetUsedUsd ?? 0,
    system_prompt: user.systemPrompt ?? null,
    workspace_dir: user.workspaceDir ?? null,
    model_template_id: user.modelTemplateId ?? null,
    model_allow_json: serializeModelAllowJson(user.modelAllow),
  };
}

export class UserRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "model_template_id")) {
      this.db.exec("ALTER TABLE users ADD COLUMN model_template_id TEXT");
    }
    if (!columns.some((c) => c.name === "model_allow_json")) {
      this.db.exec("ALTER TABLE users ADD COLUMN model_allow_json TEXT");
    }
    if (!columns.some((c) => c.name === "api_key_lookup")) {
      this.db.exec("ALTER TABLE users ADD COLUMN api_key_lookup TEXT");
    }
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_lookup ON users(api_key_lookup) WHERE api_key_lookup IS NOT NULL"
    );
    this.migrateGrokModelAllow();
  }

  /** Move legacy Sorux Grok policies onto PI's built-in xAI provider. */
  private migrateGrokModelAllow(): void {
    const rows = this.db
      .prepare("SELECT user_id, model_allow_json FROM users WHERE model_allow_json IS NOT NULL")
      .all() as Array<{ user_id: string; model_allow_json: string }>;
    const update = this.db.prepare("UPDATE users SET model_allow_json = ? WHERE user_id = ?");
    for (const row of rows) {
      if (!row.model_allow_json.includes("soruxgpt") && !row.model_allow_json.includes("grok-5.4")) continue;
      let allow: Array<{ provider: string; modelId: string }>;
      try {
        allow = JSON.parse(row.model_allow_json) as Array<{ provider: string; modelId: string }>;
      } catch {
        continue;
      }
      if (!Array.isArray(allow)) continue;
      let changed = false;
      const next = allow.map((rule) => {
        if (rule?.provider === "soruxgpt" && (rule.modelId === "grok-5.4" || rule.modelId === "grok-4.5")) {
          changed = true;
          return { ...rule, provider: "xai", modelId: "grok-4.5" };
        }
        return rule;
      });
      if (changed) update.run(JSON.stringify(next), row.user_id);
    }
  }

  close(): void {
    this.db.close();
  }

  countUsers(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return row.n;
  }

  findAll(): UserAccount[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
    return rows.map(rowToUser);
  }

  findById(userId: string): UserAccount | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  findByUsername(username: string): UserAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username.trim()) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  findByApiKeyLookup(lookup: string): UserAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM users WHERE api_key_lookup = ?")
      .get(lookup) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  insert(user: UserAccount): void {
    const row = userToRow(user);
    this.db
      .prepare(
        `INSERT INTO users (
          user_id, api_key_hash, api_key_lookup, display_name, username, role, created_at,
          token_quota, tokens_used, budget_usd, budget_used_usd, system_prompt, workspace_dir,
          model_template_id, model_allow_json
        ) VALUES (
          @user_id, @api_key_hash, @api_key_lookup, @display_name, @username, @role, @created_at,
          @token_quota, @tokens_used, @budget_usd, @budget_used_usd, @system_prompt, @workspace_dir,
          @model_template_id, @model_allow_json
        )`
      )
      .run(row);
  }

  update(user: UserAccount): void {
    const row = userToRow(user);
    this.db
      .prepare(
        `UPDATE users SET
          api_key_hash = @api_key_hash,
          api_key_lookup = @api_key_lookup,
          display_name = @display_name,
          username = @username,
          role = @role,
          token_quota = @token_quota,
          tokens_used = @tokens_used,
          budget_usd = @budget_usd,
          budget_used_usd = @budget_used_usd,
          system_prompt = @system_prompt,
          workspace_dir = @workspace_dir,
          model_template_id = @model_template_id,
          model_allow_json = @model_allow_json
        WHERE user_id = @user_id`
      )
      .run(row);
  }

  delete(userId: string): void {
    this.db.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
  }

  setStoredApiKey(userId: string, apiKeyPlain: string): void {
    this.db
      .prepare(
        `INSERT INTO stored_api_keys (user_id, api_key_plain, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           api_key_plain = excluded.api_key_plain,
           updated_at = excluded.updated_at`
      )
      .run(userId, apiKeyPlain, Date.now());
  }

  getStoredApiKey(userId: string): string | null {
    const row = this.db
      .prepare("SELECT api_key_plain FROM stored_api_keys WHERE user_id = ?")
      .get(userId) as { api_key_plain: string } | undefined;
    return row?.api_key_plain ?? null;
  }

  /** Backfill lookup fingerprints from stored plaintext keys when missing. */
  backfillApiKeyLookups(computeLookup: (plainKey: string) => string): number {
    let updated = 0;
    for (const user of this.findAll()) {
      if (user.apiKeyLookup) continue;
      const plain = this.getStoredApiKey(user.userId);
      if (!plain) continue;
      user.apiKeyLookup = computeLookup(plain);
      this.update(user);
      updated += 1;
    }
    return updated;
  }

  /** Import legacy users.json once when the database is empty. */
  migrateFromJson(jsonPath: string): number {
    if (this.countUsers() > 0) return 0;
    let raw: string;
    try {
      raw = fs.readFileSync(jsonPath, "utf-8");
    } catch {
      return 0;
    }
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return 0;

    const insertAll = this.db.transaction((users: UserAccount[]) => {
      for (const u of users) this.insert(u);
    });
    insertAll(data as UserAccount[]);
    return data.length;
  }
}

export function openUserRepository(dbPath: string): UserRepository {
  return new UserRepository(dbPath);
}
