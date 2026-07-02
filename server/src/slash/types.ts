// ============================================================
// PI Web Platform - Slash Command Types
// ============================================================

import type { PISessionManager } from "../pi/session-manager.js";

export type SlashCommand =
  | "model.set"
  | "model.cycle"
  | "model.setScoped"
  | "settings.set"
  | "session.new"
  | "session.resume"
  | "session.fork"
  | "session.tree"
  | "session.navigateTree"
  | "session.abortBranchSummary"
  | "session.compact"
  | "session.name"
  | "session.stats"
  | "session.copy"
  | "session.exportHtml"
  | "session.exportJsonl"
  | "session.importJsonl"
  | "session.reload";

export interface SlashRequest {
  command: SlashCommand;
  args: Record<string, unknown>;
}

export interface SlashResponse {
  ok: boolean;
  command?: string;
  data?: unknown;
  message?: string;
}

export interface SlashContext {
  userId: string;
  workspacePath: string;
  activeSessionId?: string;
  sessionManager: PISessionManager;
}

export interface SlashExecutePayload {
  command: string;
  args: Record<string, unknown>;
}

export type SlashHandler = (
  ctx: SlashContext,
  args: Record<string, unknown>
) => SlashResponse | Promise<SlashResponse>;

import path from "node:path";

/**
 * Resolve a user-supplied relative path so that it stays inside the workspace.
 * Throws if path traversal is detected.
 */
export function resolveWorkspacePath(
  workspacePath: string,
  targetPath: string
): string {
  const resolved = path.resolve(workspacePath, targetPath);
  if (
    !resolved.startsWith(workspacePath + path.sep) &&
    resolved !== workspacePath
  ) {
    throw new Error("Path traversal denied: path must be inside workspace");
  }
  return resolved;
}
