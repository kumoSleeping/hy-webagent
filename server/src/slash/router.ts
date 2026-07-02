// ============================================================
// PI Web Platform - Slash Command Router
// ============================================================
// Receives { command, args } and dispatches to typed handlers.
// All handlers return { ok, data?, message? }.

import type { AuthSystem } from "../auth.js";
import type { PISessionManager } from "../pi/session-manager.js";
import type {
  SlashCommand,
  SlashContext,
  SlashHandler,
  SlashRequest,
  SlashResponse,
} from "./types.js";
import * as model from "./model.js";
import * as settings from "./settings.js";
import * as session from "./session.js";

const handlers: Record<SlashCommand, SlashHandler> = {
  "model.set": model.setModel,
  "model.cycle": model.cycleModel,
  "model.setScoped": model.setScopedModels,
  "settings.set": settings.setSetting,
  "session.new": session.newSession,
  "session.resume": session.resumeSession,
  "session.fork": session.forkSession,
  "session.tree": session.getTree,
  "session.navigateTree": session.navigateTree,
  "session.abortBranchSummary": session.abortBranchSummary,
  "session.compact": session.compactSession,
  "session.name": session.setName,
  "session.stats": session.getStats,
  "session.copy": session.copyLastAssistant,
  "session.exportHtml": session.exportHtml,
  "session.exportJsonl": session.exportJsonl,
  "session.importJsonl": session.importJsonl,
  "session.reload": async (ctx, _args) => {
    const ps = ctx.sessionManager.getSession(ctx.activeSessionId!);
    if (!ps) return { ok: false, message: "No active session" };

    await ps.session.reload();

    // Rebuild the dynamic commands list after reload
    const prompts = ps.session.resourceLoader.getPrompts().prompts.map((p: any) => ({
      id: p.name,
      label: p.name,
      description: p.description || "Prompt template",
      kind: "prompt",
      source: p.sourceInfo?.source || "prompt",
    }));

    const skills = ps.session.resourceLoader.getSkills().skills.map((s: any) => ({
      id: `skill:${s.name}`,
      label: `skill:${s.name}`,
      description: s.description || "Skill",
      kind: "skill",
      source: s.sourceInfo?.source || "skill",
    }));

    const extCommands = ((ps.session as any).extensionRunner?.getRegisteredCommands?.() || []).map((c: any) => ({
      id: c.invocationName,
      label: c.invocationName,
      description: c.description || "Extension command",
      kind: "extension",
      source: c.sourceInfo?.source || "extension",
    }));

    return {
      ok: true,
      data: { dynamic: [...prompts, ...skills, ...extCommands] },
      message: "Extensions reloaded",
    };
  },
};

export async function dispatch(
  ctx: SlashContext,
  req: SlashRequest
): Promise<SlashResponse> {
  const command = req.command as SlashCommand;
  const handler = handlers[command];
  if (!handler) {
    return { ok: false, command, message: `Unknown slash command: ${req.command}` };
  }
  try {
    const result = await handler(ctx, (req.args as Record<string, unknown>) || {});
    return { ...result, command };
  } catch (err) {
    return { ok: false, command, message: (err as Error).message };
  }
}

/**
 * WebSocket-facing entry point used by the chat handler.
 * Resolves the active session and dispatches the command.
 */
export async function executeSlashCommand(
  command: string,
  args: Record<string, unknown>,
  activeSessionId: string,
  sessionManager: PISessionManager,
  userId: string,
  _authSystem: AuthSystem
): Promise<SlashResponse> {
  const ps = sessionManager.getSession(activeSessionId);
  if (!ps) {
    return { ok: false, message: "Session not found" };
  }
  const ctx: SlashContext = {
    userId,
    workspacePath: ps.workspacePath,
    activeSessionId,
    sessionManager,
  };
  return dispatch(ctx, { command: command as SlashCommand, args });
}

export type { SlashContext, SlashRequest, SlashResponse } from "./types.js";
