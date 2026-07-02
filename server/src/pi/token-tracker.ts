import type { TokenUsageRecord } from "../types.js";

export class TokenTracker {
  private usage = new Map<
    string,
    { totalInput: number; totalOutput: number; totalCacheRead: number; totalCacheWrite: number }
  >();

  record(userId: string, input: number, output: number, cacheRead: number, cacheWrite: number) {
    const current = this.usage.get(userId) || {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
    };
    current.totalInput += input;
    current.totalOutput += output;
    current.totalCacheRead += cacheRead;
    current.totalCacheWrite += cacheWrite;
    this.usage.set(userId, current);
  }

  getUsage(userId: string) {
    return (
      this.usage.get(userId) || {
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
      }
    );
  }

  getTotalTokens(userId: string): number {
    const u = this.getUsage(userId);
    return u.totalInput + u.totalOutput;
  }

  reset(userId: string) {
    this.usage.delete(userId);
  }
}
