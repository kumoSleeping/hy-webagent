/** Format /session stats for the commands float panel — readable, not raw JSON. */

function formatTokenCount(count: number): string {
  if (!Number.isFinite(count)) return "?";
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatTokensValue(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const t = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof t.input === "number" && t.input) parts.push(`↑${formatTokenCount(t.input)}`);
  if (typeof t.output === "number" && t.output) parts.push(`↓${formatTokenCount(t.output)}`);
  if (typeof t.cacheRead === "number" && t.cacheRead) parts.push(`R${formatTokenCount(t.cacheRead)}`);
  if (typeof t.cacheWrite === "number" && t.cacheWrite) parts.push(`W${formatTokenCount(t.cacheWrite)}`);
  return parts.length > 0 ? parts.join(" ") : "0";
}

function formatCostValue(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function formatContextUsageValue(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const c = value as { tokens?: number; contextWindow?: number; percent?: number | null };
  const window = typeof c.contextWindow === "number" ? formatTokenCount(c.contextWindow) : "?";
  let pct: string;
  if (typeof c.percent === "number" && Number.isFinite(c.percent)) {
    pct = `${c.percent.toFixed(1)}%`;
  } else if (typeof c.tokens === "number" && typeof c.contextWindow === "number" && c.contextWindow > 0) {
    pct = `${((c.tokens / c.contextWindow) * 100).toFixed(1)}%`;
  } else {
    pct = "?";
  }
  const used = typeof c.tokens === "number" ? formatTokenCount(c.tokens) : null;
  return used ? `${pct} · ${used}/${window}` : `${pct} / ${window}`;
}

function shortPath(path: string, max = 42): string {
  if (path.length <= max) return path;
  const base = path.split("/").pop() ?? path;
  if (base.length >= max - 1) return `…${base.slice(-(max - 1))}`;
  const head = max - base.length - 1;
  return `${path.slice(0, Math.max(8, head))}…/${base}`;
}

const LABELS: Record<string, string> = {
  sessionFile: "File",
  sessionId: "Session",
  userMessages: "User",
  assistantMessages: "Assistant",
  toolCalls: "Tools",
  toolResults: "Results",
  totalMessages: "Messages",
  tokens: "Tokens",
  cost: "Cost",
  contextUsage: "Context",
};

export interface FormattedStatRow {
  key: string;
  label: string;
  detail: string;
  /** Full value for hover / title when detail is shortened. */
  titleAttr?: string;
}

export function formatSessionStats(data: unknown): FormattedStatRow[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  return Object.entries(data as Record<string, unknown>).map(([key, value]) => {
    const label = LABELS[key] ?? key;
    if (key === "tokens") {
      return { key, label, detail: formatTokensValue(value), titleAttr: JSON.stringify(value) };
    }
    if (key === "cost") {
      return { key, label, detail: formatCostValue(value) };
    }
    if (key === "contextUsage") {
      return { key, label, detail: formatContextUsageValue(value), titleAttr: JSON.stringify(value) };
    }
    if (key === "sessionFile" && typeof value === "string") {
      return { key, label, detail: shortPath(value), titleAttr: value };
    }
    if (key === "sessionId" && typeof value === "string") {
      const short = value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
      return { key, label, detail: short, titleAttr: value };
    }
    if (value != null && typeof value === "object") {
      return { key, label, detail: JSON.stringify(value) };
    }
    return { key, label, detail: String(value ?? "") };
  });
}
