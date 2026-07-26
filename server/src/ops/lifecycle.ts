// ============================================================
// PI Web Platform - Process Lifecycle (keep-alive foundation)
// ============================================================
// Single owner of process-level signals and fatal-error handling.
//
// Nothing else in the codebase may call process.on("SIGTERM"|"SIGINT") or
// process.exit() during normal operation. Installing a signal listener
// suppresses Node's default terminate-on-signal, so a listener that forgets to
// exit turns every `systemctl restart` into a TimeoutStopSec hang ending in
// SIGKILL — which loses in-flight agent turns and corrupts the SQLite WAL.

import type { Server } from "node:http";
import type { WebSocketServer } from "ws";
import { createLogger } from "../logger.js";

const log = createLogger("lifecycle");

/** WebSocket close code 1012 = "Service Restart" — clients should reconnect. */
const WS_CLOSE_SERVICE_RESTART = 1012;

export interface ShutdownTask {
  name: string;
  /** Keep individual tasks well under `graceMs`; a hung task must not block the rest. */
  run: () => void | Promise<void>;
}

export interface LifecycleOptions {
  server: Server;
  wss: WebSocketServer;
  tasks: ShutdownTask[];
  /**
   * Hard deadline for the whole drain. Must be comfortably below the unit's
   * TimeoutStopSec (20s in scripts/systemd/hy-webagent.service) so we exit on
   * our own terms rather than being SIGKILLed mid-write.
   */
  graceMs?: number;
  /** Per-task budget, so one wedged task cannot consume the whole grace window. */
  taskTimeoutMs?: number;
  onShutdownStart?: () => void;
}

export type ShutdownReason =
  | "SIGTERM"
  | "SIGINT"
  | "SIGHUP"
  | "uncaughtException"
  | "unhandledRejection";

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Reset module state. Tests only — the real process shuts down exactly once. */
export function resetLifecycleForTests(): void {
  shuttingDown = false;
}

function withTimeout(task: ShutdownTask, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) log.error(`shutdown task "${task.name}" failed: ${(err as Error).message}`);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      log.warn(`shutdown task "${task.name}" timed out after ${ms}ms — continuing`);
      resolve();
    }, ms);
    // Do not let the timer itself hold the loop open once everything else is done.
    timer.unref?.();
    try {
      Promise.resolve(task.run()).then(() => done(), done);
    } catch (err) {
      done(err);
    }
  });
}

export function installLifecycle(options: LifecycleOptions): {
  shutdown: (reason: ShutdownReason, exitCode?: number) => Promise<void>;
} {
  const { server, wss, tasks } = options;
  const graceMs = options.graceMs ?? 15_000;
  const taskTimeoutMs = options.taskTimeoutMs ?? 5_000;

  async function shutdown(reason: ShutdownReason, exitCode = 0): Promise<void> {
    if (shuttingDown) {
      log.warn(`shutdown already in progress — ignoring ${reason}`);
      return;
    }
    shuttingDown = true;
    log.info(`shutdown started (${reason}), grace ${graceMs}ms`);
    options.onShutdownStart?.();

    // Absolute backstop: if the drain itself wedges, still exit before systemd
    // escalates to SIGKILL. unref() so a fast, clean drain is not held open by it.
    const hardExit = setTimeout(() => {
      log.error(`graceful shutdown exceeded ${graceMs}ms — forcing exit`);
      process.exit(exitCode || 1);
    }, graceMs);
    hardExit.unref?.();

    try {
      // 1. Stop accepting new work first, so the drain below converges.
      await new Promise<void>((resolve) => server.close(() => resolve()));
      log.info("http listener closed");

      // 2. Tell WS clients to reconnect (1012 triggers the client's retry path)
      //    rather than dropping them into an ambiguous transport error.
      let closed = 0;
      for (const client of wss.clients) {
        try {
          client.close(WS_CLOSE_SERVICE_RESTART, "server restarting");
          closed++;
        } catch {
          // Already-dead socket — nothing to do.
        }
      }
      if (closed) log.info(`signalled ${closed} websocket client(s) to reconnect`);

      // 3. Flush and release state. Sequential: ordering matters (persist usage
      //    before closing the DB), and these are short.
      for (const task of tasks) {
        await withTimeout(task, taskTimeoutMs);
      }

      log.info("shutdown complete");
    } catch (err) {
      log.error(`shutdown error: ${(err as Error).message}`);
      exitCode = exitCode || 1;
    } finally {
      clearTimeout(hardExit);
      process.exit(exitCode);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));

  // A fatal error leaves the process in an undefined state — drain what we can,
  // then exit non-zero so systemd restarts us into a clean one.
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception: ${err?.stack ?? String(err)}`);
    void shutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason.stack : String(reason);
    log.error(`unhandled rejection: ${err}`);
    void shutdown("unhandledRejection", 1);
  });

  // EADDRINUSE and friends: log with context instead of an opaque uncaught throw.
  server.on("error", (err) => {
    log.error(`http server error: ${(err as Error).message}`);
    void shutdown("uncaughtException", 1);
  });

  return { shutdown };
}
