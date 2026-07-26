const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

interface LoginGuardEntry {
  failures: number;
  lockedUntil: number;
}

/**
 * Cap on tracked source IPs. The map is keyed by a value an attacker can vary
 * (a botnet, or a spoofed hop if the trust-proxy depth is ever misconfigured),
 * so it needs a ceiling or it becomes a slow memory leak. When full we first
 * drop entries whose lock has expired, and only then the oldest insertion —
 * Map preserves insertion order, so the first key is the least recent.
 */
const MAX_TRACKED_IPS = 10_000;

const byIp = new Map<string, LoginGuardEntry>();

function evictIfFull(): void {
  if (byIp.size < MAX_TRACKED_IPS) return;
  const now = Date.now();
  for (const [ip, entry] of byIp) {
    if (entry.lockedUntil <= now) byIp.delete(ip);
  }
  while (byIp.size >= MAX_TRACKED_IPS) {
    const oldest = byIp.keys().next();
    if (oldest.done) break;
    byIp.delete(oldest.value);
  }
}

export function resetLoginGuardForTests(): void {
  byIp.clear();
}

export function checkLoginAllowed(ip: string): { ok: true } | { ok: false; message: string } {
  const entry = byIp.get(ip);
  if (!entry) return { ok: true };
  if (entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    return { ok: false, message: `Too many failed login attempts. Try again in ${minutes} minute(s).` };
  }
  return { ok: true };
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const existing = byIp.get(ip);
  if (!existing) evictIfFull();
  const entry = existing ?? { failures: 0, lockedUntil: 0 };
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    entry.failures = 0;
    entry.lockedUntil = 0;
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = 0;
  }
  byIp.set(ip, entry);
}

export function recordLoginSuccess(ip: string): void {
  byIp.delete(ip);
}
