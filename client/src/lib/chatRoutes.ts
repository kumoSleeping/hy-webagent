/** Build the URL path for a chat session. */
export function chatPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

/** Extract session id from a pathname like `/chat/:sessionId`. */
export function parseSessionIdFromPath(pathname: string): string | null {
  const chatMatch = pathname.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) return decodeURIComponent(chatMatch[1]);
  const previewMatch = pathname.match(/^\/preview\/([^/]+)$/);
  if (previewMatch) return decodeURIComponent(previewMatch[1]);
  return null;
}
