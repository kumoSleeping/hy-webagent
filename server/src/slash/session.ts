// ============================================================
// PI Web Platform - Slash Command: Session Handlers
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";
import type { SlashContext, SlashResponse } from "./types.js";
import { resolveWorkspacePath } from "./types.js";
import { mapSessionTree } from "../pi/session-tree.js";
import { findSessionFilePath } from "../pi/session-files.js";
import { agentCwdFromWorkspace } from "../pi/isolation.js";

function getUserSession(ctx: SlashContext) {
  const ps = ctx.activeSessionId
    ? ctx.sessionManager.getSession(ctx.activeSessionId)
    : ctx.sessionManager.getSessionForUser(ctx.userId);
  if (!ps) throw new Error("No active PI session");
  return ps;
}

export async function newSession(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const options = args.parentSession
    ? { parentSession: args.parentSession as string }
    : undefined;
  const result = await ctx.sessionManager.runtimeNewSession(ps.sessionId, options);
  if (result.cancelled) {
    return { ok: true, message: "New session cancelled" };
  }
  return {
    ok: true,
    data: { sessionId: result.sessionId },
    message: `Created new session ${result.sessionId}`,
  };
}

export async function resumeSession(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const sessionId = args.sessionId as string | undefined;
  if (!sessionId) {
    return { ok: false, message: "sessionId is required" };
  }
  const ps = getUserSession(ctx);
  const sessionsDir = path.join(ctx.workspacePath, ".pi", "sessions");
  const sessionPath = await findSessionFilePath(sessionsDir, sessionId);
  if (!sessionPath) {
    return { ok: false, message: `Session not found: ${sessionId}` };
  }
  const result = await ctx.sessionManager.runtimeResumeSession(
    ps.sessionId,
    sessionPath,
    agentCwdFromWorkspace(ctx.workspacePath)
  );
  if (result.cancelled) {
    return { ok: true, message: "Resume cancelled" };
  }
  const activeId = result.sessionId ?? ps.sessionId;
  return {
    ok: true,
    data: { sessionId: activeId },
    message: `Resumed session ${activeId}`,
  };
}

export async function forkSession(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const entryId = args.entryId as string | undefined;
  const position = args.position as "before" | "at" | undefined;

  let targetId = entryId;
  if (!targetId) {
    const userMessages = ps.session.getUserMessagesForForking();
    const lastUserMessage = userMessages[userMessages.length - 1];
    targetId = lastUserMessage?.entryId;
  }
  if (!targetId) {
    return { ok: false, message: "Session has no user message to fork from" };
  }

  const result = await ctx.sessionManager.runtimeForkSession(ps.sessionId, targetId, position);
  if (result.cancelled) {
    return { ok: true, message: "Fork cancelled" };
  }
  return {
    ok: true,
    data: { sessionId: result.sessionId, selectedText: result.selectedText },
    message: `Forked session to ${result.sessionId}`,
  };
}

export async function getTree(
  ctx: SlashContext,
  _args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const leafId = ps.session.sessionManager.getLeafId();
  const tree = mapSessionTree(ps.session.sessionManager.getTree(), leafId);
  return { ok: true, data: { tree, currentEntryId: leafId ?? undefined } };
}

export async function navigateTree(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const targetId = args.targetId as string | undefined;
  if (!targetId) {
    return { ok: false, message: "targetId is required" };
  }
  const ps = getUserSession(ctx);
  const result = await ps.session.navigateTree(targetId, {
    summarize: args.summarize as boolean | undefined,
    customInstructions: args.customInstructions as string | undefined,
    replaceInstructions: args.replaceInstructions as boolean | undefined,
    label: args.label as string | undefined,
  });
  return { ok: true, data: result };
}

export async function abortBranchSummary(
  ctx: SlashContext,
  _args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  ps.session.abortBranchSummary();
  return { ok: true, message: "Branch summary cancelled" };
}

export async function compactSession(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const result = await ps.session.compact(
    args.customInstructions as string | undefined
  );
  return { ok: true, data: result, message: "Session compacted" };
}

export async function setName(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const name = args.name as string | undefined;
  if (!name) {
    return { ok: false, message: "name is required" };
  }
  const ps = getUserSession(ctx);
  ps.session.setSessionName(name);
  return {
    ok: true,
    data: { name },
    message: `Session renamed to "${name}"`,
  };
}

export async function getStats(
  ctx: SlashContext,
  _args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const stats = ps.session.getSessionStats();
  return { ok: true, data: stats };
}

export async function copyLastAssistant(
  ctx: SlashContext,
  _args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const text = ps.session.getLastAssistantText();
  return {
    ok: true,
    data: { text },
    message: text
      ? "Copied last assistant message"
      : "No assistant message available",
  };
}

// Exports default into the platform-internal .pi/exports/ dir (dot-prefixed,
// so it never shows up in the user's own file browser) rather than the
// workspace root — the user's visible workspace should only ever contain
// their own files, not conversation artifacts we generate on their behalf.
async function defaultExportPath(workspacePath: string, ext: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportsDir = path.join(workspacePath, ".pi", "exports");
  await fs.mkdir(exportsDir, { recursive: true });
  return path.join(exportsDir, `session-export-${timestamp}.${ext}`);
}

export async function exportHtml(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const outputPath = args.outputPath
    ? resolveWorkspacePath(ctx.workspacePath, args.outputPath as string)
    : await defaultExportPath(ctx.workspacePath, "html");
  const filePath = await ps.session.exportToHtml(outputPath);
  return {
    ok: true,
    data: { filePath },
    message: `Exported HTML to ${filePath}`,
  };
}

export async function exportJsonl(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const ps = getUserSession(ctx);
  const outputPath = args.outputPath
    ? resolveWorkspacePath(ctx.workspacePath, args.outputPath as string)
    : await defaultExportPath(ctx.workspacePath, "jsonl");
  const filePath = ps.session.exportToJsonl(outputPath);
  return {
    ok: true,
    data: { filePath },
    message: `Exported JSONL to ${filePath}`,
  };
}

export async function importJsonl(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const sourcePath = args.sourcePath as string | undefined;
  if (!sourcePath) {
    return { ok: false, message: "sourcePath is required" };
  }

  const resolvedSource = resolveWorkspacePath(ctx.workspacePath, sourcePath);
  const ps = getUserSession(ctx);
  const result = await ctx.sessionManager.runtimeImportFromJsonl(ps.sessionId, resolvedSource);
  if (result.cancelled) {
    return { ok: true, message: "Import cancelled" };
  }
  return {
    ok: true,
    data: { sessionId: ps.sessionId },
    message: `Imported session ${ps.sessionId}`,
  };
}
