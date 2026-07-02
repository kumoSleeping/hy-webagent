import { timingSafeEqual } from "node:crypto";

/** Known weak / placeholder values — refuse startup if ADMIN_KEY equals one of these. */
export const FORBIDDEN_ADMIN_KEY_PLACEHOLDERS = new Set([
  "change-me-in-production",
  "change-me",
  "sk-hyw-DevKey9ChangeMe24",
  "pi-admin-dev-key-change-me",
]);

const MIN_ADMIN_KEY_LENGTH = 16;

/**
 * Resolve optional master admin key from ADMIN_KEY.
 * Returns null when unset (master-key auth disabled).
 * Throws when set to a forbidden placeholder or too short.
 */
export function resolveAdminKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.ADMIN_KEY?.trim();
  if (!raw) return null;

  if (FORBIDDEN_ADMIN_KEY_PLACEHOLDERS.has(raw)) {
    throw new Error(
      `ADMIN_KEY is set to a forbidden placeholder ("${raw}"). ` +
        "Generate a strong random value or unset ADMIN_KEY to disable master-key auth."
    );
  }
  if (raw.length < MIN_ADMIN_KEY_LENGTH) {
    throw new Error(`ADMIN_KEY must be at least ${MIN_ADMIN_KEY_LENGTH} characters when set.`);
  }
  return raw;
}

/** Constant-time string comparison for bearer tokens. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** True when configured master key is present and matches bearer. */
export function matchesMasterAdminKey(bearer: string, configuredKey: string | null): boolean {
  if (!configuredKey) return false;
  return timingSafeEqualString(bearer, configuredKey);
}

/**
 * One-time stdout notice after first admin user is created.
 * The API key is never written to disk.
 */
export function printFirstAdminKeyNotice(plainKey: string): void {
  const border = "═".repeat(52);
  console.log(`\n╔${border}╗`);
  console.log(`║  First admin created — save this API key now       ║`);
  console.log(`║  ${plainKey.padEnd(49)}║`);
  console.log(`║  Saved in platform.db; also shown here once.       ║`);
  console.log(`╚${border}╝\n`);
}
