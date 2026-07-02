import type { IncomingMessage } from "node:http";
import { config } from "./config.js";

function parseAllowedOrigins(): string[] {
  return config.corsOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isWebSocketOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return config.wsAllowNoOrigin;
  }
  return parseAllowedOrigins().includes(origin);
}
