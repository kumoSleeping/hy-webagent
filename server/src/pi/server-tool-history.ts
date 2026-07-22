import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ServerToolActivityPayload } from "./web-ui-context.js";

export const SERVER_TOOL_ENTRY_TYPE = "pi-web-server-tool:v1";

export interface PersistedServerToolActivity extends ServerToolActivityPayload {
  recordedAt: number;
}

export function readServerToolActivities(
  sessionManager: SessionManager,
): PersistedServerToolActivity[] {
  const activities: PersistedServerToolActivity[] = [];
  for (const entry of sessionManager.buildContextEntries()) {
    if (entry.type !== "custom" || entry.customType !== SERVER_TOOL_ENTRY_TYPE) continue;
    const activity = parseServerToolActivity(entry.data);
    if (activity) activities.push(activity);
  }
  return activities;
}

export function parseServerToolActivity(value: unknown): PersistedServerToolActivity | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.phase !== "start" && data.phase !== "done") return null;
  if (typeof data.toolCallId !== "string" || typeof data.toolName !== "string") return null;
  if (!data.input || typeof data.input !== "object" || Array.isArray(data.input)) return null;
  if (typeof data.recordedAt !== "number" || !Number.isFinite(data.recordedAt)) return null;
  return {
    phase: data.phase,
    toolCallId: data.toolCallId,
    toolName: data.toolName,
    input: data.input as Record<string, unknown>,
    output: typeof data.output === "string" ? data.output : undefined,
    recordedAt: data.recordedAt,
  };
}
