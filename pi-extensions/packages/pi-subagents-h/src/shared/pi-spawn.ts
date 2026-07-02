import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TASK_ARG_LIMIT = 8000;

interface SpawnInput {
  task: string;
  model?: string;
  cwd?: string;
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
    args.push("--model", input.model);
  }

  // Worker tools: full read/write
  args.push("--tools", "read,grep,find,ls,bash,edit,write");

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

  const env: Record<string, string> = {
    PI_SUBAGENT_CHILD: "1",
  };

  return { command: "pi", args, env, tempDir };
}

export function cleanupTempDir(tempDir: string | null | undefined): void {
  if (!tempDir) return;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
