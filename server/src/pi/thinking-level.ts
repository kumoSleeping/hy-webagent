/** Canonical PI thinking levels (SDK wire values). */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ThinkingLevelId = (typeof THINKING_LEVELS)[number];

/** User-facing labels — `xhigh` is shown as Max. */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevelId, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Max",
};

/** Accept wire values and the Max alias; returns canonical SDK level or null. */
export function normalizeThinkingLevel(value: string): ThinkingLevelId | null {
  const v = value.trim().toLowerCase();
  if (v === "max") return "xhigh";
  if ((THINKING_LEVELS as readonly string[]).includes(v)) {
    return v as ThinkingLevelId;
  }
  return null;
}

/** Status-bar / tree preview label. */
export function formatThinkingLevel(level: string | undefined | null): string {
  if (!level || level === "off") return "thinking off";
  const normalized = normalizeThinkingLevel(level) ?? level;
  if (normalized === "off") return "thinking off";
  return THINKING_LEVEL_LABELS[normalized as ThinkingLevelId] ?? normalized;
}
