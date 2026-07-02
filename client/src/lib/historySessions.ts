import type { SessionSummary } from "../stores/sessionStore";
import { formatUserMessagePreview } from "./prepareAttachments";

export function isActiveSessionSummary(
  session: SessionSummary,
  activePiSessionId: string | null
): boolean {
  return (
    session.id === activePiSessionId
    || (activePiSessionId?.startsWith("pending-") === true && session.title === "New Chat")
  );
}

/** Hide empty placeholder sessions unless they are the active chat. */
export function filterVisibleSessions(
  sessions: SessionSummary[],
  activePiSessionId: string | null
): SessionSummary[] {
  return sessions.filter(
    (s) => s.title !== "(empty)" || isActiveSessionSummary(s, activePiSessionId)
  );
}

/** Title substring filter for the resume/history panel — case-insensitive. */
export function filterSessionsByQuery(
  sessions: SessionSummary[],
  query: string
): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((s) =>
    formatUserMessagePreview(s.title).toLowerCase().includes(needle)
  );
}

/** Index of the current session in a visible history list — 0 if none match. */
export function indexOfActiveSession(
  sessions: SessionSummary[],
  activePiSessionId: string | null
): number {
  const idx = sessions.findIndex((s) => isActiveSessionSummary(s, activePiSessionId));
  return idx >= 0 ? idx : 0;
}

/**
 * After deleting the row at `deletedIndex`, pick the next keyboard/hover target:
 * prefer the row below (same index once the list compacts), else the row above.
 */
export function nextHistoryIndexAfterDelete(deletedIndex: number, newLength: number): number {
  if (newLength <= 0) return 0;
  if (deletedIndex < 0) return 0;
  if (deletedIndex < newLength) return deletedIndex;
  return newLength - 1;
}
