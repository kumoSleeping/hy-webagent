#!/usr/bin/env node
// Benchmark script for slash command latency.
// Usage: npx tsx src/test/benchmark-api.ts

import { dispatch } from "../slash/router.js";
import type { PISessionManager } from "../pi/session-manager.js";
import { vi } from "vitest";

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function createMockSessionManager(): PISessionManager {
  return {
    getAvailableModels: vi.fn().mockReturnValue(
      Array.from({ length: 50 }, (_, i) => ({
        provider: "anthropic",
        id: `model-${i}`,
        name: `Model ${i}`,
      }))
    ),
    setModel: vi.fn().mockResolvedValue(undefined),
    cycleModel: vi.fn().mockResolvedValue({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      thinkingLevel: "medium",
      isScoped: false,
    }),
    setScopedModels: vi.fn().mockReturnValue(undefined),
    setThinkingLevel: vi.fn().mockReturnValue(undefined),
    setSteeringMode: vi.fn().mockReturnValue(undefined),
    setFollowUpMode: vi.fn().mockReturnValue(undefined),
    setSessionName: vi.fn().mockReturnValue(undefined),
    compact: vi.fn().mockResolvedValue({ summary: "summary" }),
    getSessionStats: vi.fn().mockReturnValue({
      sessionId: "sess-1",
      userMessages: 10,
      assistantMessages: 10,
      toolCalls: 2,
      toolResults: 2,
      totalMessages: 22,
      tokens: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 3000 },
      cost: 0.1,
    }),
    getSessionTree: vi.fn().mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `entry-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        preview: `message ${i}`,
        children: [],
      }))
    ),
    navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    newSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-new" }),
    resumeSession: vi.fn().mockResolvedValue({ cancelled: false }),
    forkSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-fork" }),
    exportToHtml: vi.fn().mockResolvedValue("/tmp/export.html"),
    exportToJsonl: vi.fn().mockReturnValue("/tmp/export.jsonl"),
    importFromJsonl: vi.fn().mockResolvedValue({ cancelled: false }),
    getLastAssistantText: vi.fn().mockReturnValue("last assistant text"),
  } as unknown as PISessionManager;
}

const commands: Array<{ command: string; args: Record<string, unknown> }> = [
  { command: "model.set", args: { provider: "anthropic", modelId: "claude-sonnet-4" } },
  { command: "model.cycle", args: {} },
  { command: "settings.set", args: { key: "thinkingLevel", value: "high" } },
  { command: "session.stats", args: {} },
  { command: "session.copy", args: {} },
  { command: "session.compact", args: {} },
  { command: "session.name", args: { name: "benchmark session" } },
  { command: "session.tree", args: {} },
  { command: "session.exportJsonl", args: {} },
  { command: "session.exportHtml", args: {} },
];

async function runBenchmark(iterations = 100) {
  const sessionManager = createMockSessionManager();
  const ctx = {
    userId: "user-1",
    workspacePath: "/tmp/workspace",
    activeSessionId: "sess-1",
    sessionManager,
  };

  console.log(`Running ${iterations} iterations per command...\n`);

  for (const { command, args } of commands) {
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await dispatch(ctx, { command: command as any, args });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      `${command.padEnd(22)} min=${times[0].toFixed(3).padStart(8)}ms p50=${percentile(times, 50).toFixed(3).padStart(8)}ms p95=${percentile(times, 95).toFixed(3).padStart(8)}ms p99=${percentile(times, 99).toFixed(3).padStart(8)}ms`
    );
  }
}

runBenchmark().catch(console.error);
