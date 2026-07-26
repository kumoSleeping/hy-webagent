// ============================================================
// PI Web Platform - systemd notify / watchdog (keep-alive)
// ============================================================
// Why this matters: `Restart=always` only recovers a process that *exits*. It
// cannot detect a process that is alive but wedged — a blocked event loop, an
// exhausted handle pool, a deadlocked native addon. The listening socket stays
// open, so a TCP probe passes too. The watchdog closes that gap: if WATCHDOG=1
// stops arriving, systemd declares the unit failed and restarts it. The ping is
// scheduled on the event loop, so it stops precisely when the loop stops turning.
//
// Implementation note: sd_notify(3) speaks AF_UNIX SOCK_DGRAM, which Node core
// cannot open (node:dgram supports only udp4/udp6). We therefore shell out to
// the `systemd-notify` helper, which every systemd install ships. Because the
// datagram then originates from a child PID rather than the main one, the unit
// must set `NotifyAccess=all` — see scripts/systemd/hy-webagent.service.
//
// Every function is a no-op when NOTIFY_SOCKET is unset or the helper is
// missing (dev, Docker, tests), so this is safe to call unconditionally.

import { execFile } from "node:child_process";
import fs from "node:fs";
import { createLogger } from "../logger.js";

const log = createLogger("sd-notify");

let helperPath: string | null | undefined;
let watchdogTimer: NodeJS.Timeout | null = null;
let warnedMissingHelper = false;

export function isSystemdManaged(): boolean {
  return Boolean(process.env.NOTIFY_SOCKET);
}

function resolveHelper(): string | null {
  if (helperPath !== undefined) return helperPath;
  if (!isSystemdManaged()) {
    helperPath = null;
    return null;
  }
  // Resolved by absolute path rather than PATH lookup: this runs as a service,
  // and an inherited PATH should not decide which binary we execute.
  const candidates = ["/usr/bin/systemd-notify", "/bin/systemd-notify"];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      if (require("node:fs").existsSync(candidate)) {
        helperPath = candidate;
        return helperPath;
      }
    } catch {
      // Fall through to the next candidate.
    }
  }
  helperPath = null;
  if (!warnedMissingHelper) {
    warnedMissingHelper = true;
    log.warn("NOTIFY_SOCKET is set but systemd-notify was not found — watchdog disabled");
  }
  return null;
}

/**
 * Fire-and-forget a sd_notify message.
 *
 * execFile (not exec) so arguments are passed as an argv array and never reach a
 * shell. Never throws or rejects: telemetry must not be able to kill the service
 * it is reporting on.
 */
function notify(...assignments: string[]): void {
  const helper = resolveHelper();
  if (!helper || assignments.length === 0) return;
  try {
    execFile(helper, assignments, { timeout: 2_000 }, (err) => {
      if (err) log.debug(`sd_notify ${assignments[0]} failed: ${err.message}`);
    });
  } catch (err) {
    log.debug(`sd_notify unavailable: ${(err as Error).message}`);
  }
}

/** Signal that startup finished and the service is serving. Pairs with Type=notify. */
export function notifyReady(status?: string): void {
  notify("--ready", ...(status ? [`--status=${status}`] : []));
}

/** Update the one-line status shown by `systemctl status`. */
export function notifyStatus(status: string): void {
  notify(`--status=${status}`);
}

/** Signal that shutdown has begun, so systemd does not read the drain as a hang. */
export function notifyStopping(): void {
  notify("STOPPING=1");
}

/**
 * Begin pinging the watchdog.
 *
 * systemd exposes its deadline as WATCHDOG_USEC. We ping at half that interval —
 * the cadence sd_notify(3) recommends — leaving a full period of slack for a
 * transient stall before systemd escalates to a restart.
 *
 * `isHealthy` is evaluated on every tick and must be cheap, synchronous, and
 * non-throwing. Returning false withholds the ping deliberately: that is how a
 * process which is running but irrecoverably degraded (dead DB handle, wedged
 * renderer) gets restarted instead of lingering as a black hole.
 */
export function startWatchdog(isHealthy?: () => boolean): void {
  if (!isSystemdManaged() || watchdogTimer) return;
  if (!resolveHelper()) return;

  const usec = Number(process.env.WATCHDOG_USEC);
  if (!Number.isFinite(usec) || usec <= 0) return;

  // Guards the case where WATCHDOG_USEC was inherited by a forked child.
  const watchdogPid = process.env.WATCHDOG_PID;
  if (watchdogPid && Number(watchdogPid) !== process.pid) return;

  const intervalMs = Math.max(1_000, Math.floor(usec / 1000 / 2));
  log.info(`systemd watchdog active — pinging every ${intervalMs}ms`);

  watchdogTimer = setInterval(() => {
    try {
      if (isHealthy && !isHealthy()) {
        log.error("health probe failed — withholding watchdog ping to force a restart");
        return;
      }
      notify("WATCHDOG=1");
    } catch {
      // A keepalive tick must never throw into the loop it is monitoring.
    }
  }, intervalMs);
  watchdogTimer.unref?.();
}

export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/** Reset cached probe state. Tests only. */
export function resetSdNotifyForTests(): void {
  helperPath = undefined;
  warnedMissingHelper = false;
  stopWatchdog();
}
