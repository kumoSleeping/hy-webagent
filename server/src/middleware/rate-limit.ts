import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { config } from "../config.js";

/**
 * Resolve the client IP for rate-limit / lockout keying.
 *
 * Uses `req.ip`, which Express derives from X-Forwarded-For while honouring the
 * `trust proxy` setting (index.ts sets it to 1 — exactly one reverse proxy hop).
 * Reading the raw header here instead would let any client mint an arbitrary
 * bucket key per request and bypass every limiter that depends on this.
 */
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "Too many requests. Please try again later." },
});

/**
 * Credential-verification limiter for /auth/login and /bot/login.
 *
 * Each attempt costs a bcrypt(cost=12) comparison, so these endpoints are a CPU
 * amplification vector as much as a credential-guessing one. Kept deliberately
 * tighter than the general API limiter and counted per IP regardless of outcome.
 */
export const loginRateLimiter = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: "Too many login attempts. Please try again later." },
});
