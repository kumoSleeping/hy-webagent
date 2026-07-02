/**
 * Web-platform-only agent sandbox extension.
 *
 * Loaded exclusively via DefaultResourceLoader.extensionFactories in
 * createPlatformResourceLoader() for non-admin sessions only — never install
 * under ~/.pi/agent/extensions.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  type AgentSandboxContext,
  isProcessOpsConfirmEcho,
  validateAgentToolPath,
  validateBashCommand,
} from "../agent-sandbox.js";

const PATH_INPUT_KEYS = ["path", "file_path", "filePath", "file"] as const;

function optionalPathFromTool(event: {
  toolName: string;
  input: Record<string, unknown>;
}): string | undefined {
  for (const key of PATH_INPUT_KEYS) {
    const value = event.input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function createPlatformSandboxFactory(ctx: AgentSandboxContext): ExtensionFactory {
  let processOpsConfirmed = false;

  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event) => {
      if (isToolCallEventType("bash", event)) {
        const command = event.input.command;
        if (typeof command !== "string") return undefined;

        if (isProcessOpsConfirmEcho(command)) {
          processOpsConfirmed = true;
          return undefined;
        }

        const blocked = validateBashCommand(ctx, command, { processOpsConfirmed });
        if (blocked) {
          return { block: true, reason: blocked.reason };
        }
        return undefined;
      }

      const rawPath = optionalPathFromTool(event);
      if (rawPath === undefined) {
        return undefined;
      }

      const check = validateAgentToolPath(ctx, rawPath);
      if (!check.ok) {
        return { block: true, reason: check.reason };
      }

      return undefined;
    });
  };
}
