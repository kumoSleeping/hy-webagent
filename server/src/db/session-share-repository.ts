import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_shares (
  token_hash TEXT PRIMARY KEY,
  pi_session_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_viewed_at INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_session_shares_session
  ON session_shares(pi_session_id);
CREATE INDEX IF NOT EXISTS idx_session_shares_owner
  ON session_shares(owner_user_id);
`;

/** 256 bits. Guest links are unauthenticated, so the token *is* the credential. */
const TOKEN_BYTES = 32;

export interface SessionShare {
  piSessionId: string;
  ownerUserId: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastViewedAt: number | null;
  viewCount: number;
}

function hashToken(token: string): string {
  // SHA-256 with no salt is correct here (unlike a password): the input is
  // 256 bits of CSPRNG output, so there is nothing to brute-force or rainbow.
  // Hashing at rest means a database read does not hand over live share links.
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateShareToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Owner-issued, revocable, optionally expiring read-only links to a session.
 *
 * Exists because guest view is unauthenticated: without an explicit grant there
 * is no way to tell "the owner published this" from "someone guessed an id",
 * which is precisely the hole that let any session be read by anyone.
 */
export class SessionShareRepository {
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

  /**
   * Issue a token. Returns the plaintext exactly once — it is not recoverable
   * afterwards, which is why the API surfaces it only in the create response.
   */
  create(input: {
    piSessionId: string;
    ownerUserId: string;
    ttlMs?: number | null;
  }): { token: string; share: SessionShare } {
    const token = generateShareToken();
    const now = Date.now();
    const expiresAt = input.ttlMs ? now + input.ttlMs : null;

    this.db
      .prepare(
        `INSERT INTO session_shares
         (token_hash, pi_session_id, owner_user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(hashToken(token), input.piSessionId, input.ownerUserId, now, expiresAt);

    return {
      token,
      share: {
        piSessionId: input.piSessionId,
        ownerUserId: input.ownerUserId,
        createdAt: now,
        expiresAt,
        revokedAt: null,
        lastViewedAt: null,
        viewCount: 0,
      },
    };
  }

  /**
   * Resolve a token to its grant, or null if it is unknown, revoked or expired.
   *
   * Lookup is by hash, so an attacker with read access to the database still
   * cannot use what they find.
   */
  resolve(token: string): SessionShare | null {
    if (!token) return null;
    const row = this.db
      .prepare("SELECT * FROM session_shares WHERE token_hash = ?")
      .get(hashToken(token)) as Record<string, unknown> | undefined;
    if (!row) return null;

    const share = this.mapShare(row);
    if (share.revokedAt !== null) return null;
    if (share.expiresAt !== null && share.expiresAt <= Date.now()) return null;
    return share;
  }

  /** Record a successful view. Best-effort telemetry; never blocks serving. */
  recordView(token: string): void {
    try {
      this.db
        .prepare(
          `UPDATE session_shares
           SET view_count = view_count + 1, last_viewed_at = ?
           WHERE token_hash = ?`,
        )
        .run(Date.now(), hashToken(token));
    } catch {
      // Telemetry must not break the read path.
    }
  }

  /** Active (non-revoked, non-expired) grants for a session. */
  listForSession(piSessionId: string): SessionShare[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM session_shares
         WHERE pi_session_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(piSessionId, now) as Record<string, unknown>[];
    return rows.map((row) => this.mapShare(row));
  }

  /**
   * Revoke every grant for a session. Scoped by owner so a caller can only ever
   * revoke their own. Returns the number of grants revoked.
   */
  revokeAllForSession(piSessionId: string, ownerUserId: string): number {
    const result = this.db
      .prepare(
        `UPDATE session_shares SET revoked_at = ?
         WHERE pi_session_id = ? AND owner_user_id = ? AND revoked_at IS NULL`,
      )
      .run(Date.now(), piSessionId, ownerUserId);
    return result.changes;
  }

  /** Drop grants revoked or expired more than `olderThanMs` ago. */
  prune(olderThanMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db
      .prepare(
        `DELETE FROM session_shares
         WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
            OR (expires_at IS NOT NULL AND expires_at < ?)`,
      )
      .run(cutoff, cutoff);
    return result.changes;
  }

  private mapShare(row: Record<string, unknown>): SessionShare {
    return {
      piSessionId: row.pi_session_id as string,
      ownerUserId: row.owner_user_id as string,
      createdAt: row.created_at as number,
      expiresAt: (row.expires_at as number | null) ?? null,
      revokedAt: (row.revoked_at as number | null) ?? null,
      lastViewedAt: (row.last_viewed_at as number | null) ?? null,
      viewCount: (row.view_count as number) ?? 0,
    };
  }
}
