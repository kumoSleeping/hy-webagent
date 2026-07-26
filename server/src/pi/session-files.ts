import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Pi session ids are UUIDs; anything else is not a resolvable session. */
const SESSION_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate a caller-supplied session id before it reaches the filesystem.
 *
 * Every route that accepts `:id` / `piSessionId` from a request must gate on this.
 * It rejects both traversal attempts and the wildcard-ish partial ids that a
 * lenient filename match would otherwise resolve to an arbitrary session.
 */
export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

/**
 * Pi stores sessions as `{iso-timestamp}_{sessionId}.jsonl`, not `{sessionId}.jsonl`.
 * Match the id as a whole filename stem.
 *
 * This match is deliberately exact. A substring match here (`f.includes(bare)`)
 * meant a partial id such as "-" matched the first file whose name merely
 * contained it — every ISO timestamp does — letting a caller resolve a session
 * they never named, in a workspace that is not theirs.
 */
export async function findSessionFilePath(
  sessionsDir: string,
  sessionId: string
): Promise<string | null> {
  const bare = sessionId.endsWith(".jsonl") ? sessionId.slice(0, -".jsonl".length) : sessionId;
  if (!isValidSessionId(bare)) return null;

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }

  const exact = `${bare}.jsonl`;
  const suffixed = `_${bare}.jsonl`;
  const match = files.find((f) => f === exact || f.endsWith(suffixed));
  return match ? join(sessionsDir, match) : null;
}
