import { spawn } from "node:child_process";
import type { Message } from "@earendil-works/pi-ai";
import type { SingleResult, Usage } from "../shared/types.ts";
import { buildPiArgs, cleanupTempDir } from "../shared/pi-spawn.ts";

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

/** Get the last assistant text from the message list — avoids leaking intermediate reasoning/tool-call texts. */
function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const part of content) {
        // Only pick up text blocks — skip thinking/reasoning/tool_call blocks
        if ((part as any).type === "text" && typeof (part as any).text === "string") {
          return (part as any).text;
        }
      }
    }
  }
  return "";
}

interface RunOptions {
  task: string;
  model?: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Comma-separated tool allowlist. */
  tools?: string;
  /** Thinking level. */
  thinking?: string;
}

export function runSubagent(options: RunOptions): Promise<SingleResult> {
  return new Promise((resolve) => {
    const { command, args, env, tempDir } = buildPiArgs({
      task: options.task,
      model: options.model,
      cwd: options.cwd,
      tools: options.tools,
      thinking: options.thinking,
    });

    const result: SingleResult = {
      task: options.task,
      exitCode: 0,
      messages: [],
      usage: emptyUsage(),
      model: options.model,
    };

    const proc = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    let settled = false;
    let stderrBuf = "";
    let interrupted = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;

      if (buf.trim()) {
        try {
          const evt = JSON.parse(buf) as { type?: string; message?: Message };
          if (evt.type === "message_end" && evt.message) {
            result.messages.push(evt.message);
          }
        } catch {}
      }

      result.exitCode = interrupted ? 0 : code;
      result.interrupted = interrupted;

      const finalText = getFinalOutput(result.messages);

      if (interrupted && !finalText) {
        result.finalOutput = "[Interrupted before producing output]";
      } else if (interrupted) {
        result.finalOutput = "[INTERRUPTED]\n\n" + finalText;
      } else {
        result.finalOutput = finalText || "(no output)";
      }

      if (!interrupted && code !== 0 && !result.error) {
        result.error = stderrBuf.trim() || `Exited with code ${code}`;
      }

      cleanupTempDir(tempDir);
      resolve(result);
    };

    const doInterrupt = () => {
      if (settled) return;
      interrupted = true;
      proc.kill("SIGINT");
      setTimeout(() => {
        if (!settled) { proc.kill("SIGTERM"); }
      }, 8000);
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as { type?: string; message?: Message };
          if (evt.type === "message_end" && evt.message) {
            result.messages.push(evt.message);
            if (evt.message.role === "assistant") {
              result.usage.turns++;
              const u = evt.message.usage;
              if (u) {
                result.usage.input += u.input || 0;
                result.usage.output += u.output || 0;
                result.usage.cacheRead += u.cacheRead || 0;
                result.usage.cacheWrite += u.cacheWrite || 0;
                result.usage.cost += u.cost?.total || 0;
              }
              if (!result.model && evt.message.model) {
                result.model = evt.message.model;
              }
            }
          }
        } catch {}
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString(); });
    proc.on("close", (code: number | null) => finish(code ?? 1));
    proc.on("error", (err: Error) => { result.error = err.message; finish(1); });

    if (options.signal) {
      if (options.signal.aborted) doInterrupt();
      else options.signal.addEventListener("abort", doInterrupt, { once: true });
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      setTimeout(() => { if (!settled) doInterrupt(); }, options.timeoutMs);
    }
  });
}
