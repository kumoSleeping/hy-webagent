// ============================================================
// PI Web Platform - Health probes
// ============================================================
// Two distinct probes, because they answer different questions and a watchdog
// that conflates them will do the wrong thing:
//
//   liveness  — "is this process still able to make progress?"
//               A failure here means RESTART. Must not depend on anything a
//               restart cannot fix, or the service ends up in a crash loop.
//
//   readiness — "should this instance be serving traffic right now?"
//               A failure here means TAKE OUT OF ROTATION. It legitimately
//               fails for reasons a restart would not repair (dependency down).
//
// The previous /health returned a static {ok:true}: it proved the event loop
// and HTTP stack were alive but reported nothing about the SQLite handle or the
// shared Chromium renderer, either of which can be permanently dead while the
// port still accepts connections.

import type { Database } from "better-sqlite3";
import { createLogger } from "../logger.js";

const log = createLogger("health");

/** Event-loop delay above this means the process is wedged, not merely busy. */
const EVENT_LOOP_STALL_MS = 30_000;
/** Sampling period for the event-loop lag probe. */
const LOOP_SAMPLE_MS = 1_000;

let lastTick = Date.now();
let loopTimer: NodeJS.Timeout | null = null;

/**
 * Measure event-loop responsiveness by recording how late a fixed-interval
 * timer fires. This is the one signal that catches a synchronously blocked
 * loop — the failure mode `Restart=always` alone cannot see, because the
 * process never exits and the listening socket stays open.
 */
export function startEventLoopMonitor(): void {
  if (loopTimer) return;
  lastTick = Date.now();
  loopTimer = setInterval(() => {
    lastTick = Date.now();
  }, LOOP_SAMPLE_MS);
  loopTimer.unref?.();
}

export function stopEventLoopMonitor(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

export function eventLoopLagMs(): number {
  return Math.max(0, Date.now() - lastTick - LOOP_SAMPLE_MS);
}

export interface HealthDeps {
  db: () => Database;
  sessionCount: () => number;
  /** Build metadata, surfaced so a deploy can be confirmed without shell access. */
  version: string;
  commit: string;
}

export interface CheckResult {
  ok: boolean;
  detail?: string;
}

export interface ReadinessReport {
  ok: boolean;
  uptimeSeconds: number;
  version: string;
  commit: string;
  eventLoopLagMs: number;
  sessions: number;
  memory: { rssMb: number; heapUsedMb: number };
  checks: Record<string, CheckResult>;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/**
 * Liveness. Deliberately narrow: only conditions a restart actually repairs.
 *
 * Also used to gate the systemd watchdog ping, so it must be cheap, synchronous
 * and non-throwing — it runs on every watchdog tick.
 */
export function isAlive(): boolean {
  return eventLoopLagMs() < EVENT_LOOP_STALL_MS;
}

export function livenessPayload(deps: HealthDeps) {
  return {
    ok: isAlive(),
    time: Date.now(),
    uptimeSeconds: Math.round(process.uptime()),
    version: deps.version,
    commit: deps.commit,
    eventLoopLagMs: eventLoopLagMs(),
  };
}

/**
 * Readiness. Actually exercises the dependencies rather than asserting them.
 *
 * A failure sets ok=false and the route answers 503, but the process is left
 * running: SQLite being briefly unavailable is not something restarting fixes,
 * and flapping the process would only widen the outage.
 */
export function readiness(deps: HealthDeps): ReadinessReport {
  const checks: Record<string, CheckResult> = {};

  checks.eventLoop = isAlive()
    ? { ok: true }
    : { ok: false, detail: `event loop stalled ${eventLoopLagMs()}ms` };

  try {
    // A real round trip through the driver — proves the handle is open and the
    // file is readable, which a cached boolean would not.
    deps.db().prepare("SELECT 1").get();
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, detail: (err as Error).message };
    log.error(`readiness: database probe failed: ${(err as Error).message}`);
  }

  let sessions = 0;
  try {
    sessions = deps.sessionCount();
    checks.sessionManager = { ok: true };
  } catch (err) {
    checks.sessionManager = { ok: false, detail: (err as Error).message };
  }

  const memory = process.memoryUsage();

  return {
    ok: Object.values(checks).every((c) => c.ok),
    uptimeSeconds: Math.round(process.uptime()),
    version: deps.version,
    commit: deps.commit,
    eventLoopLagMs: eventLoopLagMs(),
    sessions,
    memory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed) },
    checks,
  };
}
