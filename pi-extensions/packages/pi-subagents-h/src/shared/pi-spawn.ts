import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const TASK_ARG_LIMIT = 8000;

interface SpawnInput {
  task: string;
  model?: string;
  /** Comma-separated tool allowlist. Default: full read/write set. */
  tools?: string;
  /** Thinking level: off, minimal, low, medium, high, xhigh */
  thinking?: string;
}

export interface SpawnResult {
  command: string;
  args: string[];
  env: Record<string, string>;
  tempDir?: string;
}

export function buildPiArgs(input: SpawnInput): SpawnResult {
  const args: string[] = ["--mode", "json", "-p"];

  args.push("--no-session");

  if (input.model) {
    if (typeof input.model !== "string") {
      throw new Error(`Invalid model option: expected string, got ${typeof input.model}`);
    }
    args.push("--model", input.model);
  }

  if (input.thinking) {
    args.push("--thinking", input.thinking);
  }

  if (input.tools) {
    args.push("--tools", input.tools);
  }

  // Large task → temp file
  let tempDir: string | undefined;
  if (input.task.length > TASK_ARG_LIMIT) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worker-"));
    const taskPath = path.join(tempDir, "task.md");
    fs.writeFileSync(taskPath, `Task: ${input.task}`, { mode: 0o600 });
    args.push(`@${taskPath}`);
  } else {
    args.push(`Task: ${input.task}`);
  }

  // Point child pi to the same agent dir as the parent so it loads the same
  // user config (settings, models, auth keys) and bundled extensions.
  const agentDir = process.env.PI_CODING_AGENT_DIR || getAgentDir();

  const env: Record<string, string> = {
    PI_SUBAGENT_CHILD: "1",
    PI_CODING_AGENT_DIR: agentDir,
  };

  return { command: "pi", args, env, tempDir };
}

export function cleanupTempDir(tempDir: string | null | undefined): void {
  if (!tempDir) return;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
