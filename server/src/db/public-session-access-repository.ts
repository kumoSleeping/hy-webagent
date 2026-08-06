import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS public_session_access (
  pi_session_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  enabled_at INTEGER NOT NULL
);
`;

export interface PublicSessionAccess {
  piSessionId: string;
  ownerUserId: string;
  enabledAt: number;
}

/**
 * Durable, owner-issued permission for the ordinary `/chat/:sessionId` URL to
 * be opened without a login. This is deliberately separate from token shares:
 * a token only authorizes the URL that carries that token, while this record
 * authorizes the normal address-bar URL.
 */
export class PublicSessionAccessRepository {
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

  /** Enable public read-only access. Repeating the command is safe. */
  enable(piSessionId: string, ownerUserId: string): PublicSessionAccess {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO public_session_access (pi_session_id, owner_user_id, enabled_at)
         VALUES (?, ?, ?)
         ON CONFLICT(pi_session_id) DO NOTHING`,
      )
      .run(piSessionId, ownerUserId, now);

    const access = this.resolve(piSessionId);
    if (!access) throw new Error("Failed to enable public session access");
    if (access.ownerUserId !== ownerUserId) {
      throw new Error("Session public access belongs to another user");
    }
    return access;
  }

  /** Remove an owner's ordinary-URL guest access grant. */
  disable(piSessionId: string, ownerUserId: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM public_session_access
         WHERE pi_session_id = ? AND owner_user_id = ?`,
      )
      .run(piSessionId, ownerUserId);
    return result.changes > 0;
  }

  /** Resolve the owner of a session whose ordinary URL was made public. */
  resolve(piSessionId: string): PublicSessionAccess | null {
    const row = this.db
      .prepare(
        `SELECT pi_session_id, owner_user_id, enabled_at
         FROM public_session_access WHERE pi_session_id = ?`,
      )
      .get(piSessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      piSessionId: row.pi_session_id as string,
      ownerUserId: row.owner_user_id as string,
      enabledAt: row.enabled_at as number,
    };
  }
}
