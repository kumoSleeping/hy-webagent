const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

interface LoginGuardEntry {
  failures: number;
  lockedUntil: number;
}

const byIp = new Map<string, LoginGuardEntry>();

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
  const entry = byIp.get(ip) ?? { failures: 0, lockedUntil: 0 };
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
