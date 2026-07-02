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
  const sensitive = [
    ".env",
    "credentials",
    "secret",
    ".pem",
    ".key",
    "id_rsa",
    "auth.json",
    "platform-admin.json",
    "platform.db",
  ];
  if (sensitive.some((s) => basename.includes(s))) {
    throw new Error(`Access to sensitive file denied: ${basename}`);
  }
  if (targetPath.includes("/etc/") || targetPath.includes("/proc/")) {
    throw new Error("System path access denied");
  }
}

/** Exact phrase the user/agent must echo once per session to unlock process-management bash. */
export const PROCESS_OPS_CONFIRM_PHRASE =
  "HYW确认：本次操作仅针对本工作区内由用户产生的进程，不会影响系统服务或服务器上的其他资源。";

export function processOpsConfirmPrompt(): string {
  return [
    "进程管理命令（ps、pgrep、pkill、kill、killall、top、htop 等）在本会话中首次使用前需要确认。",
    "请向用户说明：目标进程必须是由用户在本工作区产生的，不能是系统服务，也不能影响服务器上的其他资源。",
    "用户确认后，请运行：",
    "",
    `echo '${PROCESS_OPS_CONFIRM_PHRASE}'`,
    "",
    "确认后本会话内可继续使用上述进程管理命令。",
  ].join("\n");
}

export function isProcessOpsConfirmEcho(command: string): boolean {
  const trimmed = command.trim();
  if (!/^echo\s+/i.test(trimmed)) return false;

  const quoted = /^echo\s+(["'])((?:\\.|(?!\1).)*)\1\s*$/s.exec(trimmed);
  if (quoted?.[2] === PROCESS_OPS_CONFIRM_PHRASE) return true;

  const unquoted = trimmed.replace(/^echo\s+/i, "").trim();
  return unquoted === PROCESS_OPS_CONFIRM_PHRASE;
}

const PROCESS_MGMT_CMD =
  /(?:^|[\s|;|&])(?:sudo\s+)?(?:\/usr\/bin\/|\/bin\/)?(?:ps|pgrep|pkill|kill|killall|top|htop|jobs|fg|bg|lsof|fuser)\b/i;

export function isProcessManagementCommand(command: string): boolean {
  return PROCESS_MGMT_CMD.test(command.trim());
}

const SYSTEM_SERVICE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsystemctl\b/i, reason: "系统服务管理命令被禁止（systemctl）" },
  { pattern: /\bservice\s+\S+/i, reason: "系统服务管理命令被禁止（service）" },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: "系统电源/重启命令被禁止" },
  { pattern: /\bdocker\b/i, reason: "Docker 命令被禁止（可能影响宿主机其他容器）" },
  { pattern: /\bpm2\s+(?:restart|reload|stop|delete|kill)\b/i, reason: "PM2 进程管理被禁止（可能影响系统服务）" },
  { pattern: /\biptables\b/i, reason: "网络/防火墙配置命令被禁止" },
];

export interface ValidateBashOptions {
  /** Set after the session runs the one-time process-ops confirm echo. */
  processOpsConfirmed?: boolean;
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
  command: string,
  options?: ValidateBashOptions
): { block: true; reason: string } | undefined {
  const danger = checkDangerousCommand(command);
  if (danger.dangerous) {
    return { block: true, reason: danger.reason ?? "Dangerous command blocked" };
  }

  for (const { pattern, reason } of SYSTEM_SERVICE_PATTERNS) {
    if (pattern.test(command)) {
      return { block: true, reason };
    }
  }

  for (const { pattern, reason } of BASH_PLATFORM_PATTERNS) {
    if (pattern.test(command)) {
      return { block: true, reason };
    }
  }

  if (isProcessManagementCommand(command) && !options?.processOpsConfirmed) {
    return { block: true, reason: processOpsConfirmPrompt() };
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
