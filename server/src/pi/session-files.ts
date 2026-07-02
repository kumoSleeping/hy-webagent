import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Pi stores sessions as `{iso-timestamp}_{sessionId}.jsonl`, not `{sessionId}.jsonl`.
 * Match by header id embedded in the filename (same rule as activate / list).
 */
export async function findSessionFilePath(
  sessionsDir: string,
  sessionId: string
): Promise<string | null> {
  const bare = sessionId.endsWith(".jsonl") ? sessionId.slice(0, -".jsonl".length) : sessionId;

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }

  const match = files.find((f) => f.endsWith(".jsonl") && f.includes(bare));
  return match ? join(sessionsDir, match) : null;
}
