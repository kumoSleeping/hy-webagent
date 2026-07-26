import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { installLifecycle, resetLifecycleForTests } from "../ops/lifecycle.js";
import {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  eventLoopLagMs,
  isAlive,
  readiness,
} from "../ops/health.js";

afterEach(() => {
  resetLifecycleForTests();
  stopEventLoopMonitor();
});

describe("ops/lifecycle", () => {
  it("runs shutdown tasks in order and exits", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ noServer: true });
    const order: string[] = [];
    const exits: number[] = [];
    const realExit = process.exit;
    // @ts-expect-error — stubbed for the test
    process.exit = (code?: number) => { exits.push(code ?? 0); };

    try {
      const { shutdown } = installLifecycle({
        server,
        wss,
        tasks: [
          { name: "first", run: () => { order.push("first"); } },
          { name: "second", run: async () => { order.push("second"); } },
        ],
      });
      await shutdown("SIGTERM", 0);
      expect(order).toEqual(["first", "second"]);
      expect(exits).toEqual([0]);
    } finally {
      process.exit = realExit;
      wss.close();
    }
  });

  it("continues past a task that throws, and still exits", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ noServer: true });
    const order: string[] = [];
    const exits: number[] = [];
    const realExit = process.exit;
    // @ts-expect-error — stubbed for the test
    process.exit = (code?: number) => { exits.push(code ?? 0); };

    try {
      const { shutdown } = installLifecycle({
        server,
        wss,
        tasks: [
          { name: "boom", run: () => { throw new Error("task failed"); } },
          { name: "after", run: () => { order.push("after"); } },
        ],
      });
      await shutdown("SIGTERM", 0);
      // A failing flush must not strand the remaining cleanup.
      expect(order).toEqual(["after"]);
      expect(exits).toEqual([0]);
    } finally {
      process.exit = realExit;
      wss.close();
    }
  });

  it("does not run the drain twice when signalled repeatedly", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ noServer: true });
    let runs = 0;
    const realExit = process.exit;
    // @ts-expect-error — stubbed for the test
    process.exit = () => {};

    try {
      const { shutdown } = installLifecycle({
        server,
        wss,
        tasks: [{ name: "count", run: () => { runs += 1; } }],
      });
      await Promise.all([shutdown("SIGTERM", 0), shutdown("SIGINT", 0)]);
      expect(runs).toBe(1);
    } finally {
      process.exit = realExit;
      wss.close();
    }
  });
});

describe("ops/health", () => {
  it("reports a healthy event loop while idle", async () => {
    startEventLoopMonitor();
    await new Promise((r) => setTimeout(r, 50));
    expect(eventLoopLagMs()).toBeLessThan(30_000);
    expect(isAlive()).toBe(true);
  });

  it("marks readiness unhealthy when the database probe throws", () => {
    const report = readiness({
      db: () => { throw new Error("database is locked"); },
      sessionCount: () => 3,
      version: "test",
      commit: "abc123",
    });
    expect(report.ok).toBe(false);
    expect(report.checks.database.ok).toBe(false);
    expect(report.checks.database.detail).toContain("database is locked");
  });

  it("reports ok with a working database probe", () => {
    const fakeDb = { prepare: () => ({ get: () => ({ 1: 1 }) }) };
    const report = readiness({
      db: () => fakeDb as never,
      sessionCount: () => 2,
      version: "test",
      commit: "abc123",
    });
    expect(report.ok).toBe(true);
    expect(report.sessions).toBe(2);
    expect(report.memory.rssMb).toBeGreaterThan(0);
  });
});

describe("SIGTERM handling (integration)", () => {
  // Regression guard for the defect this work started from: UsageRecorder
  // installed a SIGTERM listener that flushed but never exited. Installing any
  // signal listener suppresses Node's default terminate-on-signal, so the
  // process stayed alive until systemd's TimeoutStopSec expired and SIGKILLed
  // it — turning every restart into a ~90s hang with in-flight work lost.
  it("a process that installs a flush-only SIGTERM listener does NOT exit", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ]);
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGTERM");

    const exited = await Promise.race([
      new Promise<boolean>((r) => child.on("exit", () => r(true))),
      new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
    ]);
    child.kill("SIGKILL");
    expect(exited).toBe(false);
  }, 10_000);

  it("exits promptly when the handler calls process.exit", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
    ]);
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGTERM");

    const code = await Promise.race([
      new Promise<number | null>((r) => child.on("exit", (c) => r(c))),
      new Promise<number | null>((r) => setTimeout(() => r(-1), 3000)),
    ]);
    expect(code).toBe(0);
  }, 10_000);
});
