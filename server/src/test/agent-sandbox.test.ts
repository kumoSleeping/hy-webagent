import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  type AgentSandboxContext,
  resolveAgentPath,
  validateAgentToolPath,
  validateBashCommand,
  isProcessManagementCommand,
  isProcessOpsConfirmEcho,
  PROCESS_OPS_CONFIRM_PHRASE,
} from "../pi/agent-sandbox.js";

function makeCtx(tmpRoot: string, userId = "alice-abc"): AgentSandboxContext & {
  userWorkspace: string;
  agentCwd: string;
} {
  const workspacesRoot = path.join(tmpRoot, "workspaces");
  const dataDir = path.join(tmpRoot, "data");
  const userWorkspace = path.join(workspacesRoot, userId);
  const agentCwd = path.join(userWorkspace, "projects");
  const databasePath = path.join(dataDir, "platform.db");

  return {
    userWorkspacePath: userWorkspace,
    agentCwd,
    workspacesRoot,
    dataDir,
    databasePath,
    userWorkspace,
  };
}

describe("AgentSandbox path validation", () => {
  it("allows paths under projects/", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateAgentToolPath(ctx, "src/main.ts")).toEqual({
      ok: true,
      resolved: path.join(ctx.agentCwd, "src/main.ts"),
    });
  });

  it("allows sibling .pi/ under the same user workspace", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateAgentToolPath(ctx, "../.pi/sessions/foo.jsonl")).toEqual({
      ok: true,
      resolved: path.join(ctx.userWorkspacePath, ".pi/sessions/foo.jsonl"),
    });
  });

  it("blocks platform data via traversal", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const check = validateAgentToolPath(ctx, "../../../data/platform.db");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/platform data|outside workspace/i);
    }
  });

  it("blocks other user workspaces", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const check = validateAgentToolPath(ctx, "../../bob-xyz/projects/secret.txt");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/other user/i);
    }
  });

  it("blocks absolute paths outside the workspace", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const outside = path.join(root, "data", "platform.db");
    const check = validateAgentToolPath(ctx, outside);
    expect(check.ok).toBe(false);
  });

  it("blocks sensitive filenames", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const check = validateAgentToolPath(ctx, ".env");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toMatch(/sensitive/i);
    }
  });
});

describe("AgentSandbox bash validation", () => {
  it("blocks dangerous commands", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateBashCommand(ctx, "rm -rf /")).toEqual({
      block: true,
      reason: expect.stringMatching(/Blocked/i),
    });
  });

  it("blocks references to platform.db", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateBashCommand(ctx, "cat ../../../data/platform.db")).toEqual({
      block: true,
      reason: expect.stringMatching(/platform database/i),
    });
  });

  it("allows normal project commands", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateBashCommand(ctx, "npm test")).toBeUndefined();
  });

  it("blocks process commands until session confirm echo", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateBashCommand(ctx, "ps aux")).toEqual({
      block: true,
      reason: expect.stringMatching(/自行确认/),
    });
    expect(isProcessManagementCommand("ps aux")).toBe(true);
    expect(isProcessOpsConfirmEcho(`echo '${PROCESS_OPS_CONFIRM_PHRASE}'`)).toBe(true);
    expect(validateBashCommand(ctx, "ps aux", { processOpsConfirmed: true })).toBeUndefined();
  });

  it("blocks ss and netstat until session confirm echo", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    for (const cmd of ["ss -tulpn", "netstat -an", "ip addr"]) {
      expect(validateBashCommand(ctx, cmd)).toEqual({
        block: true,
        reason: expect.stringMatching(/自行确认/),
      });
      expect(isProcessManagementCommand(cmd)).toBe(true);
      expect(validateBashCommand(ctx, cmd, { processOpsConfirmed: true })).toBeUndefined();
    }
  });

  it("always blocks nmap and sudo even after process confirm", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const opts = { processOpsConfirmed: true };
    expect(validateBashCommand(ctx, "sudo ps aux", opts)).toEqual({
      block: true,
      reason: expect.stringMatching(/sudo/i),
    });
    expect(validateBashCommand(ctx, "nmap localhost", opts)).toEqual({
      block: true,
      reason: expect.stringMatching(/扫描/i),
    });
  });

  it("always blocks systemctl even after process confirm", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    expect(validateBashCommand(ctx, "systemctl restart nginx", { processOpsConfirmed: true })).toEqual({
      block: true,
      reason: expect.stringMatching(/systemctl/i),
    });
  });

  it("blocks auth.json reads", () => {
    const root = path.join(os.tmpdir(), "pi-sandbox-test");
    const ctx = makeCtx(root);
    const check = validateAgentToolPath(ctx, "../.pi/agent/auth.json");
    expect(check.ok).toBe(false);
  });
});

describe("resolveAgentPath", () => {
  it("resolves relative paths from agent cwd", () => {
    const cwd = "/tmp/workspaces/u/projects";
    expect(resolveAgentPath(cwd, "foo/bar.ts")).toBe("/tmp/workspaces/u/projects/foo/bar.ts");
  });
});
