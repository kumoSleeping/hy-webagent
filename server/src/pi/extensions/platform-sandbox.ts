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
  validateAgentToolPath,
  validateBashCommand,
} from "../agent-sandbox.js";

function optionalPathFromTool(event: {
  toolName: string;
  input: Record<string, unknown>;
}): string | undefined {
  const value = event.input.path;
  return typeof value === "string" ? value : undefined;
}

export function createPlatformSandboxFactory(ctx: AgentSandboxContext): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event) => {
      if (isToolCallEventType("bash", event)) {
        const blocked = validateBashCommand(ctx, event.input.command);
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
