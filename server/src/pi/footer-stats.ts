import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { sanitizeStatusText } from "./web-ui-context.js";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home?: string): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function resolveGitBranch(cwd: string): string | null {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  if (result.status !== 0) return null;
  const branch = result.stdout.trim();
  return branch || null;
}

export interface FooterSnapshot {
  pwdLine: string;
  statsLeft: string;
  modelRight: string;
  extensionLine: string | null;
}

/** Mirror native FooterComponent.render() — plain text for web. */
export function computeFooterSnapshot(
  session: AgentSession,
  extensionStatuses: Record<string, string>,
  sidecar?: { input: number; output: number; cost: number }
): FooterSnapshot {
  const state = session.state;
  const cwd = session.sessionManager.getCwd();
  const home = process.env.HOME || process.env.USERPROFILE || homedir();

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let latestCacheHitRate: number | undefined;

  for (const entry of session.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      totalInput += entry.message.usage.input;
      totalOutput += entry.message.usage.output;
      totalCacheRead += entry.message.usage.cacheRead;
      totalCacheWrite += entry.message.usage.cacheWrite;
      totalCost += entry.message.usage.cost.total;
      const latestPromptTokens =
        entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
      latestCacheHitRate =
        latestPromptTokens > 0
          ? (entry.message.usage.cacheRead / latestPromptTokens) * 100
          : undefined;
    }
  }

  // Include sidecar (sub-agent) tokens accumulated during this session
  if (sidecar) {
    totalInput += sidecar.input;
    totalOutput += sidecar.output;
    totalCost += sidecar.cost;
  }

  const contextUsage = session.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
  const contextPercentValue = contextUsage?.percent ?? 0;
  const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

  let pwd = formatCwdForFooter(cwd, home);
  const branch = resolveGitBranch(cwd);
  if (branch) pwd = `${pwd} (${branch})`;
  const sessionName = session.sessionManager.getSessionName();
  if (sessionName) pwd = `${pwd} • ${sessionName}`;

  const statsParts: string[] = [];
  if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
  if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
  if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
  if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
  if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
    statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
  }
  const usingSubscription = state.model ? session.modelRegistry.isUsingOAuth(state.model) : false;
  if (totalCost || usingSubscription) {
    statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
  }

  const autoCompactEnabled = session.autoCompactionEnabled;
  const autoIndicator = autoCompactEnabled ? " (auto)" : "";
  const contextPercentDisplay =
    contextPercent === "?"
      ? `?/${formatTokens(contextWindow)}${autoIndicator}`
      : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
  statsParts.push(contextPercentDisplay);

  const modelName = state.model?.id || "no-model";
  let modelRight = modelName;
  if (state.model?.reasoning) {
    const thinkingLevel = state.thinkingLevel || "off";
    modelRight =
      thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
  }

  const providers = new Set(session.modelRegistry.getAvailable().map((m) => m.provider));
  if (providers.size > 1 && state.model) {
    modelRight = `(${state.model.provider}) ${modelRight}`;
  }

  const extensionLine =
    Object.keys(extensionStatuses).length > 0
      ? Object.entries(extensionStatuses)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatusText(text))
          .join(" ")
      : null;

  return {
    pwdLine: pwd,
    statsLeft: statsParts.join(" "),
    modelRight,
    extensionLine,
  };
}
