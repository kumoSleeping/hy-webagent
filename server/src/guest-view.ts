import { isValidSessionId } from "./pi/session-files.js";

/**
 * A normal conversation URL is itself a public, read-only share URL.
 *
 * Session ids must still be full UUIDs. This prevents malformed paths and
 * partial-id filename matches from reaching the session store, while allowing
 * recipients of `/chat/:sessionId` to open the shared conversation without an
 * account.
 */
export function isPublicSharedSessionUrl(piSessionId: string): boolean {
  return isValidSessionId(piSessionId);
}
