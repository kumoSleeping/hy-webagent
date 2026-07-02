import path from "node:path";
import { config } from "../config.js";
import { checkDangerousCommand } from "../security.js";

/** Resolved paths and roots for one web agent session. */
export interface AgentSandboxContext {
  userWorkspacePath: string;
  agentCwd: string;
  workspacesRoot: string;
  dataDir: string;
  databasePath: string;
}

export type AgentPathCheck =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

export function createAgentSandboxContext(
  workspacePath: string,
  agentCwd: string
): AgentSandboxContext {
  const databasePath = path.resolve(config.databasePath);
  return {
    userWorkspacePath: path.resolve(workspacePath),
    agentCwd: path.resolve(agentCwd),
    workspacesRoot: path.resolve(config.workspaceRoot),
    dataDir: path.dirname(databasePath),
    databasePath,
  };
}

export function isUnderPath(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return (
    resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep)
  );
}

export function resolveAgentPath(agentCwd: string, rawPath: string): string {
  const expanded = rawPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", rawPath.slice(1))
    : rawPath;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(agentCwd, expanded);
}

export function checkSensitivePath(targetPath: string): void {
  const basename = path.basename(targetPath).toLowerCase();
  const sensitive = [".env", "credentials", "secret", ".pem", ".key", "id_rsa"];
  if (sensitive.some((s) => basename.includes(s))) {
    throw new Error(`Access to sensitive file denied: ${basename}`);
  }
  if (targetPath.includes("/etc/") || targetPath.includes("/proc/")) {
    throw new Error("System path access denied");
  }
}

export function validateAgentToolPath(
  ctx: AgentSandboxContext,
  rawPath: string
): AgentPathCheck {
  const resolved = resolveAgentPath(ctx.agentCwd, rawPath);

  if (isUnderPath(ctx.dataDir, resolved) || resolved === ctx.databasePath) {
    return { ok: false, reason: "Platform data access denied" };
  }

  if (isUnderPath(ctx.userWorkspacePath, resolved)) {
    try {
      checkSensitivePath(resolved);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Sensitive path denied" };
    }
    return { ok: true, resolved };
  }

  if (isUnderPath(ctx.workspacesRoot, resolved)) {
    return { ok: false, reason: "Access to other user workspaces is denied" };
  }

  return { ok: false, reason: `Path outside workspace: ${rawPath}` };
}

const BASH_PLATFORM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /platform\.db/i, reason: "Platform database access denied" },
  { pattern: /(?:^|[\s"'`])\.{2}[\\/].*(?:[\\/]|^)data(?:[\\/]|$)/i, reason: "Platform data directory access denied" },
  { pattern: /\/etc\//, reason: "System path access denied" },
  { pattern: /\/proc\//, reason: "System path access denied" },
  { pattern: /\/\.ssh(?:[\\/]|$)/, reason: "SSH credentials access denied" },
];

export function validateBashCommand(
  ctx: AgentSandboxContext,
  command: string
): { block: true; reason: string } | undefined {
  const danger = checkDangerousCommand(command);
  if (danger.dangerous) {
    return { block: true, reason: danger.reason ?? "Dangerous command blocked" };
  }

  for (const { pattern, reason } of BASH_PLATFORM_PATTERNS) {
    if (pattern.test(command)) {
      return { block: true, reason };
    }
  }

  const siblingWorkspace = path.relative(ctx.userWorkspacePath, ctx.workspacesRoot);
  if (siblingWorkspace && !siblingWorkspace.startsWith("..")) {
    const escapedRoot = ctx.workspacesRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const otherWorkspace = new RegExp(
      `${escapedRoot}[\\\\/][^\\\\/\\s"'\\\`]+`,
      "i"
    );
    const match = command.match(otherWorkspace);
    if (match && !match[0].startsWith(ctx.userWorkspacePath)) {
      return { block: true, reason: "Access to other user workspaces is denied" };
    }
  }

  return undefined;
}
