// ============================================================
// PI Web Platform - Slash Command: Settings Handlers
// ============================================================

import type { SlashContext, SlashResponse } from "./types.js";

function getUserSession(ctx: SlashContext) {
  const ps = ctx.activeSessionId
    ? ctx.sessionManager.getSession(ctx.activeSessionId)
    : ctx.sessionManager.getSessionForUser(ctx.userId);
  if (!ps) throw new Error("No active PI session");
  return ps;
}

const validThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export async function setSetting(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const key = args.key as string | undefined;
  const value = args.value;
  if (!key) {
    return { ok: false, message: "key is required" };
  }

  const ps = getUserSession(ctx);
  const session = ps.session;
  const settings = session.settingsManager;

  try {
    switch (key) {
      case "thinkingLevel": {
        if (typeof value !== "string" || !validThinkingLevels.includes(value)) {
          return {
            ok: false,
            message: `Invalid thinkingLevel. Allowed: ${validThinkingLevels.join(", ")}`,
          };
        }
        session.setThinkingLevel(value as any);
        break;
      }
      case "defaultThinkingLevel": {
        if (typeof value !== "string" || !validThinkingLevels.includes(value)) {
          return {
            ok: false,
            message: `Invalid defaultThinkingLevel. Allowed: ${validThinkingLevels.join(", ")}`,
          };
        }
        settings.setDefaultThinkingLevel(value as any);
        break;
      }
      case "steeringMode": {
        if (value !== "all" && value !== "one-at-a-time") {
          return {
            ok: false,
            message: "steeringMode must be 'all' or 'one-at-a-time'",
          };
        }
        session.setSteeringMode(value);
        break;
      }
      case "followUpMode": {
        if (value !== "all" && value !== "one-at-a-time") {
          return {
            ok: false,
            message: "followUpMode must be 'all' or 'one-at-a-time'",
          };
        }
        session.setFollowUpMode(value);
        break;
      }
      case "compactionEnabled": {
        if (typeof value !== "boolean") {
          return { ok: false, message: "compactionEnabled must be boolean" };
        }
        settings.setCompactionEnabled(value);
        break;
      }
      case "retryEnabled": {
        if (typeof value !== "boolean") {
          return { ok: false, message: "retryEnabled must be boolean" };
        }
        settings.setRetryEnabled(value);
        break;
      }
      case "autoRetryEnabled": {
        if (typeof value !== "boolean") {
          return { ok: false, message: "autoRetryEnabled must be boolean" };
        }
        session.setAutoRetryEnabled(value);
        break;
      }
      case "hideThinkingBlock": {
        if (typeof value !== "boolean") {
          return { ok: false, message: "hideThinkingBlock must be boolean" };
        }
        settings.setHideThinkingBlock(value);
        break;
      }
      case "theme": {
        if (typeof value !== "string") {
          return { ok: false, message: "theme must be a string" };
        }
        settings.setTheme(value);
        break;
      }
      default:
        return { ok: false, message: `Unsupported settings key: ${key}` };
    }

    await settings.flush();
    return { ok: true, data: { key, value }, message: `Set ${key} = ${JSON.stringify(value)}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
