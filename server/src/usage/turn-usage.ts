import { isUnlimitedBudget, type AuthSystem } from "../auth.js";
import type { TokenTracker } from "../pi/token-tracker.js";
import type { UsageRecorder, UsageSource } from "./recorder.js";

export interface UsageSnapshot {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  /** Number of LLM turns aggregated into this snapshot (default 1). */
  turns?: number;
}

export function extractTurnUsage(message: {
  provider?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: {
      total?: number;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
  };
}): UsageSnapshot | null {
  if (!message.usage) return null;

  const usage = message.usage;
  const input = usage.input || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;

  let costUsd = 0;
  if (usage.cost?.total != null) {
    costUsd = usage.cost.total;
  } else if (usage.cost) {
    costUsd =
      (usage.cost.input || 0) +
      (usage.cost.output || 0) +
      (usage.cost.cacheRead || 0) +
      (usage.cost.cacheWrite || 0);
  }

  return {
    provider: String(message.provider ?? "unknown"),
    model: String(message.model ?? "unknown"),
    input,
    output,
    cacheRead,
    cacheWrite,
    costUsd,
    turns: 1,
  };
}

export interface ApplyUsageResult {
  snapshot: UsageSnapshot;
  user: ReturnType<AuthSystem["getUser"]>;
}

export function applyUsageSnapshot(params: {
  userId: string;
  source: UsageSource;
  snapshot: UsageSnapshot;
  authSystem: AuthSystem;
  tokenTracker: TokenTracker;
  usageRecorder: UsageRecorder;
}): ApplyUsageResult | null {
  const { userId, source, snapshot, authSystem, tokenTracker, usageRecorder } = params;
  const totalTokens = snapshot.input + snapshot.output;
  if (totalTokens === 0 && snapshot.costUsd === 0) return null;

  tokenTracker.record(
    userId,
    snapshot.input,
    snapshot.output,
    snapshot.cacheRead,
    snapshot.cacheWrite
  );

  const user = authSystem.getUser(userId);
  if (user) {
    usageRecorder.record({
      userId,
      displayName: user.displayName,
      provider: snapshot.provider,
      model: snapshot.model,
      input: snapshot.input,
      output: snapshot.output,
      cacheRead: snapshot.cacheRead,
      cacheWrite: snapshot.cacheWrite,
      costUsd: snapshot.costUsd,
      source,
      turns: snapshot.turns ?? 1,
    });
    authSystem.persistTurnSpend(userId, totalTokens, snapshot.costUsd);
  }

  return { snapshot, user };
}

export function applyTurnUsage(params: {
  userId: string;
  message: Parameters<typeof extractTurnUsage>[0];
  source: UsageSource;
  authSystem: AuthSystem;
  tokenTracker: TokenTracker;
  usageRecorder: UsageRecorder;
}): ApplyUsageResult | null {
  const snapshot = extractTurnUsage(params.message);
  if (!snapshot) return null;
  return applyUsageSnapshot({ ...params, snapshot });
}

export function isBudgetExceeded(user: {
  role?: "user" | "admin";
  budgetUsd?: number | null;
  budgetUsedUsd?: number;
}): boolean {
  if (isUnlimitedBudget(user as Parameters<typeof isUnlimitedBudget>[0])) return false;
  const cap = user.budgetUsd ?? 0;
  const used = user.budgetUsedUsd ?? 0;
  return cap > 0 && used >= cap;
}

export function budgetExceededMessage(user: {
  budgetUsd?: number | null;
  budgetUsedUsd?: number;
}): string {
  const cap = user.budgetUsd;
  const used = user.budgetUsedUsd ?? 0;
  if (cap === null || cap === undefined) return "Budget exceeded";
  return `Budget exceeded ($${used.toFixed(4)} / $${cap.toFixed(2)})`;
}
