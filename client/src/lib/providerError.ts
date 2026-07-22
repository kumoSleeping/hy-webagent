/**
 * Turn provider/API failure blobs (often full Cloudflare HTML pages) into a
 * short user-visible line for toasts and the chat transcript.
 */
export function summarizeProviderError(raw?: string | null): string {
  if (!raw?.trim()) return "Request failed";
  const text = raw.trim();

  if (
    /cloudflare|sorry, you have been blocked|cf-error|attention required/i.test(text) ||
    /<!DOCTYPE html>/i.test(text)
  ) {
    const host =
      text.match(/unable to access[\s\S]*?<[^>]+>([^<]+)</i)?.[1]?.trim() ||
      text.match(/\b(?:soruxgpt|openai|anthropic|x\.ai|[\w-]+)\.(?:com|ai|net|ltd)\b/i)?.[0];
    return host
      ? `Provider blocked the request (Cloudflare 403 · ${host})`
      : "Provider blocked the request (Cloudflare 403)";
  }

  const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return "Request failed";
  return stripped.length > 240 ? `${stripped.slice(0, 240)}…` : stripped;
}
