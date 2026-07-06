import type { AuthSystem } from "../auth.js";
import type { TokenTracker } from "../pi/token-tracker.js";
import type { UsageRecorder } from "./recorder.js";
import { applyUsageSnapshot, type ApplyUsageResult, type UsageSnapshot } from "./turn-usage.js";

/** Tools that run isolated LLM sessions outside the main agent loop. */
export function isSidecarToolName(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  return name === "subagent" || name.startsWith("subagent_");
}

function parseModelRef(model: unknown): { provider: string; model: string } {
  if (typeof model === "string") {
    const slash = model.indexOf("/");
    if (slash > 0) {
      return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
    }
    return { provider: "subagent", model };
  }
  if (model && typeof model === "object") {
    const m = model as { id?: string; provider?: string; name?: string; api?: string };
    const id = m.id ?? m.name ?? "unknown";
    const provider = m.provider ?? inferProviderFromApi(m.api) ?? "subagent";
    return { provider, model: id };
  }
  return { provider: "subagent", model: "unknown" };
}

function inferProviderFromApi(api?: string): string | undefined {
  if (!api) return undefined;
  if (api.includes("anthropic")) return "anthropic";
  if (api.includes("openai")) return "openai";
  if (api.includes("google")) return "google";
  return api;
}

function usageFromRecord(usage: Record<string, number>, model: unknown): UsageSnapshot | null {
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const costUsd = usage.cost ?? 0;
  const turns = Math.max(usage.turns ?? 1, 1);
  if (input + output === 0 && costUsd === 0) return null;

  const { provider, model: modelId } = parseModelRef(model);
  return { provider, model: modelId, input, output, cacheRead, cacheWrite, costUsd, turns };
}

/** Extract aggregated usage from subagent / subagent_* tool result details. */
export function extractSidecarToolUsage(toolName: string, details: unknown): UsageSnapshot[] {
  if (!isSidecarToolName(toolName) || !details || typeof details !== "object") {
    return [];
  }

  const entries: UsageSnapshot[] = [];
  const d = details as Record<string, unknown>;

  // AgentToolResult wraps extension details as { content, details, terminate? }.
  // The subagent extension sets details: { result }, so navigate: d.details.result
  const extensionDetails = d.details;
  if (extensionDetails && typeof extensionDetails === "object") {
    const inner = extensionDetails as Record<string, unknown>;
    const wrappedResult = inner.result;
    if (wrappedResult && typeof wrappedResult === "object") {
      const result = wrappedResult as Record<string, unknown>;
      const usage = result.usage;
      if (usage && typeof usage === "object") {
        const snap = usageFromRecord(usage as Record<string, number>, result.model);
        if (snap) entries.push(snap);
      }
    }
  }

  if (Array.isArray(d.results)) {
    for (const item of d.results) {
      if (!item || typeof item !== "object") continue;
      const result = item as Record<string, unknown>;
      const usage = result.usage;
      if (!usage || typeof usage !== "object") continue;
      const snap = usageFromRecord(usage as Record<string, number>, result.model);
      if (snap) entries.push(snap);
    }
  }

  return entries;
}

export function applySidecarToolUsage(params: {
  userId: string;
  toolName: string;
  details: unknown;
  authSystem: AuthSystem;
  tokenTracker: TokenTracker;
  usageRecorder: UsageRecorder;
}): ApplyUsageResult[] {
  const snapshots = extractSidecarToolUsage(params.toolName, params.details);
  const results: ApplyUsageResult[] = [];
  for (const snapshot of snapshots) {
    const applied = applyUsageSnapshot({
      userId: params.userId,
      source: "subagent",
      snapshot,
      authSystem: params.authSystem,
      tokenTracker: params.tokenTracker,
      usageRecorder: params.usageRecorder,
    });
    if (applied) results.push(applied);
  }
  return results;
}
