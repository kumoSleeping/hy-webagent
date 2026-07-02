/** Build the URL path for a chat session. */
export function chatPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

/** Extract session id from a pathname like `/chat/:sessionId`. */
export function parseSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
