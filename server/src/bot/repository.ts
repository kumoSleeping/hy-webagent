import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bot_accounts (
  user_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_channels (
  bot_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  display_name TEXT,
  platform TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bot_user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  pi_session_id TEXT PRIMARY KEY,
  bot_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  source_message_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_message_links (
  bot_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  pi_session_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_user_id, channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_sessions_channel
  ON bot_sessions(bot_user_id, channel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_public_channel
  ON bot_sessions(channel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_channels_public_id
  ON bot_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_bot_message_session
  ON bot_message_links(pi_session_id);
`;

export interface BotAccount {
  userId: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface BotChannel {
  botUserId: string;
  channelId: string;
  displayName: string | null;
  platform: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface BotSessionRecord {
  piSessionId: string;
  botUserId: string;
  channelId: string;
  sourceMessageId: string | null;
  title: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class BotRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createAccount(account: BotAccount): void {
    this.db.prepare(`INSERT INTO bot_accounts
      (user_id, slug, display_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(account.userId, account.slug, account.displayName, account.enabled ? 1 : 0, account.createdAt, account.updatedAt);
  }

  listAccounts(): BotAccount[] {
    return (this.db.prepare("SELECT * FROM bot_accounts ORDER BY created_at ASC").all() as any[]).map(this.mapAccount);
  }

  findAccountByUserId(userId: string): BotAccount | undefined {
    const row = this.db.prepare("SELECT * FROM bot_accounts WHERE user_id = ?").get(userId) as any;
    return row ? this.mapAccount(row) : undefined;
  }

  findAccountBySlug(slug: string): BotAccount | undefined {
    const row = this.db.prepare("SELECT * FROM bot_accounts WHERE slug = ? COLLATE NOCASE").get(slug) as any;
    return row ? this.mapAccount(row) : undefined;
  }

  updateAccount(userId: string, patch: { displayName?: string; enabled?: boolean }): BotAccount {
    const current = this.findAccountByUserId(userId);
    if (!current) throw new Error("Bot not found");
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.db.prepare("UPDATE bot_accounts SET display_name = ?, enabled = ?, updated_at = ? WHERE user_id = ?")
      .run(next.displayName, next.enabled ? 1 : 0, next.updatedAt, userId);
    return next;
  }

  upsertChannel(input: Omit<BotChannel, "createdAt" | "updatedAt">): BotChannel {
    const now = Date.now();
    this.db.prepare(`INSERT INTO bot_channels
      (bot_user_id, channel_id, display_name, platform, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_user_id, channel_id) DO UPDATE SET
        display_name = excluded.display_name,
        platform = excluded.platform,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`
    ).run(input.botUserId, input.channelId, input.displayName, input.platform,
      input.metadata ? JSON.stringify(input.metadata) : null, now, now);
    return this.findChannel(input.botUserId, input.channelId)!;
  }

  findChannel(botUserId: string, channelId: string): BotChannel | undefined {
    const row = this.db.prepare("SELECT * FROM bot_channels WHERE bot_user_id = ? AND channel_id = ?")
      .get(botUserId, channelId) as any;
    return row ? this.mapChannel(row) : undefined;
  }

  listChannels(botUserId: string): BotChannel[] {
    return (this.db.prepare("SELECT * FROM bot_channels WHERE bot_user_id = ? ORDER BY updated_at DESC")
      .all(botUserId) as any[]).map(this.mapChannel);
  }

  createSession(record: BotSessionRecord): void {
    this.db.prepare(`INSERT INTO bot_sessions
      (pi_session_id, bot_user_id, channel_id, source_message_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(record.piSessionId, record.botUserId, record.channelId, record.sourceMessageId,
      record.title, record.status, record.createdAt, record.updatedAt);
  }

  findSession(piSessionId: string): BotSessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM bot_sessions WHERE pi_session_id = ?").get(piSessionId) as any;
    return row ? this.mapSession(row) : undefined;
  }

  listSessions(botUserId: string, channelId: string): BotSessionRecord[] {
    return (this.db.prepare(`SELECT * FROM bot_sessions
      WHERE bot_user_id = ? AND channel_id = ? ORDER BY updated_at DESC`).all(botUserId, channelId) as any[])
      .map(this.mapSession);
  }

  updateSessionStatus(piSessionId: string, status: string): void {
    this.db.prepare("UPDATE bot_sessions SET status = ?, updated_at = ? WHERE pi_session_id = ?")
      .run(status, Date.now(), piSessionId);
  }

  linkMessage(input: { botUserId: string; channelId: string; messageId: string; piSessionId: string; direction: string }): void {
    this.db.prepare(`INSERT INTO bot_message_links
      (bot_user_id, channel_id, message_id, pi_session_id, direction, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_user_id, channel_id, message_id) DO UPDATE SET
        pi_session_id = excluded.pi_session_id, direction = excluded.direction`
    ).run(input.botUserId, input.channelId, input.messageId, input.piSessionId, input.direction, Date.now());
  }

  resolveMessage(botUserId: string, channelId: string, messageId: string): string | undefined {
    const row = this.db.prepare(`SELECT pi_session_id FROM bot_message_links
      WHERE bot_user_id = ? AND channel_id = ? AND message_id = ?`)
      .get(botUserId, channelId, messageId) as { pi_session_id: string } | undefined;
    return row?.pi_session_id;
  }

  private mapAccount(row: any): BotAccount {
    return { userId: row.user_id, slug: row.slug, displayName: row.display_name,
      enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private mapChannel(row: any): BotChannel {
    return { botUserId: row.bot_user_id, channelId: row.channel_id, displayName: row.display_name,
      platform: row.platform, metadata: parseMetadata(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private mapSession(row: any): BotSessionRecord {
    return { piSessionId: row.pi_session_id, botUserId: row.bot_user_id, channelId: row.channel_id,
      sourceMessageId: row.source_message_id, title: row.title, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
