import type { IncomingMessage } from "node:http";
import { config } from "./config.js";

/** Parse comma-separated CORS_ORIGIN values (env wins for tests/runtime overrides). */
export function parseAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? config.corsOrigin;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Also allow the http/https sibling of each configured origin (Cloudflare / mobile quirks). */
export function expandAllowedOrigins(origins: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const entry of origins) {
    allowed.add(entry);
    try {
      const url = new URL(entry);
      const host = url.host;
      if (url.protocol === "https:") allowed.add(`http://${host}`);
      if (url.protocol === "http:") allowed.add(`https://${host}`);
    } catch {
      // keep literal entry only
    }
  }
  return allowed;
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return process.env.WS_ALLOW_NO_ORIGIN === "true" || config.wsAllowNoOrigin;
  }
  return expandAllowedOrigins(parseAllowedOrigins()).has(origin);
}

export function isWebSocketOriginAllowed(request: IncomingMessage): boolean {
  return isOriginAllowed(request.headers.origin);
}
