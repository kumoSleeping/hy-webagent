/** Build the URL path for a chat session. */
export function chatPath(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

export function groupPath(botSlug: string, channelId: string): string {
  return `/${encodeURIComponent(botSlug)}/${encodeURIComponent(channelId)}`;
}

export function parseGroupPath(pathname: string): { botSlug: string; channelId: string } | null {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!match || ["chat", "preview", "logout", "api"].includes(match[1].toLowerCase())) return null;
  return { botSlug: decodeURIComponent(match[1]), channelId: decodeURIComponent(match[2]) };
}

/** Extract session id from a pathname like `/chat/:sessionId`. */
export function parseSessionIdFromPath(pathname: string): string | null {
  const chatMatch = pathname.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) {
    const id = decodeURIComponent(chatMatch[1]);
    // "new" is a transient placeholder — not a real session id.
    if (id === "new") return null;
    return id;
  }
  const previewMatch = pathname.match(/^\/preview\/([^/]+)$/);
  if (previewMatch) return decodeURIComponent(previewMatch[1]);
  return null;
}

/** True when the URL is the transient /chat/new placeholder. */
export function isNewChatPath(pathname: string): boolean {
  return /^\/chat\/new(?:\?.*)?$/.test(pathname);
}
