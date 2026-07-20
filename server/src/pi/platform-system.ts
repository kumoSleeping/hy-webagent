import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { buildSecuritySystemPrompt } from "../security.js";
import { createAgentSandboxContext, type AgentSandboxContext } from "./agent-sandbox.js";
import { createPlatformSandboxFactory } from "./extensions/platform-sandbox.js";

export const PLATFORM_RULES_MARKER = "[pi-web-platform-rules:v1]";
export const PLATFORM_BOT_RULES_MARKER = "[pi-web-platform-bot-rules:v1]";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const ADMIN_SKILLS_DIR = path.join(REPO_ROOT, "admin-skills");

const SYSTEM_MD_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../platform/SYSTEM.md"
);
const SYSTEM_BOT_MD_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../platform/SYSTEM_BOT.md"
);

export interface PlatformResourceLoaderOptions {
  includeAdminSkills?: boolean;
  /** Append bot-specific rules (no workspace litter; use upload API). */
  includeBotRules?: boolean;
  /** User workspace root — enables web tool sandbox for non-admin sessions. */
  workspacePath?: string;
  /** When false, skip sandbox (admin sessions). Default true when workspacePath is set. */
  enableSandbox?: boolean;
}

let cachedPlatformSystemMd: string | null = null;
let cachedBotSystemMd: string | null = null;

export async function loadPlatformSystemMd(): Promise<string> {
  if (cachedPlatformSystemMd) return cachedPlatformSystemMd;
  const text = await fs.readFile(SYSTEM_MD_PATH, "utf-8");
  if (!text.includes(PLATFORM_RULES_MARKER)) {
    throw new Error(`Platform SYSTEM.md missing marker ${PLATFORM_RULES_MARKER}`);
  }
  cachedPlatformSystemMd = text.trim();
  return cachedPlatformSystemMd;
}

export async function loadPlatformBotSystemMd(): Promise<string> {
  if (cachedBotSystemMd) return cachedBotSystemMd;
  const text = await fs.readFile(SYSTEM_BOT_MD_PATH, "utf-8");
  if (!text.includes(PLATFORM_BOT_RULES_MARKER)) {
    throw new Error(`Platform SYSTEM_BOT.md missing marker ${PLATFORM_BOT_RULES_MARKER}`);
  }
  cachedBotSystemMd = text.trim();
  return cachedBotSystemMd;
}

/** Sections appended to every agent system prompt (platform rules + code security layer). */
export async function buildPlatformAppendSections(includeBotRules = false): Promise<string[]> {
  const platform = await loadPlatformSystemMd();
  const sections = [platform];
  if (includeBotRules) {
    sections.push(await loadPlatformBotSystemMd());
  }
  const security = buildSecuritySystemPrompt().trim();
  if (security) sections.push(security);
  return sections;
}

export function assertPlatformRulesLoaded(systemPrompt: string): void {
  if (!systemPrompt.includes(PLATFORM_RULES_MARKER)) {
    throw new Error("Platform rules were not injected into the agent system prompt");
  }
}

export function assertBotRulesLoaded(systemPrompt: string): void {
  if (!systemPrompt.includes(PLATFORM_BOT_RULES_MARKER)) {
    throw new Error("Bot rules were not injected into the agent system prompt");
  }
}

export function getPlatformResourceLoaderOptions(includeBotRules = false): {
  appendSystemPromptOverride: (base: string[]) => string[];
} {
  return {
    appendSystemPromptOverride: (base: string[]) => {
      // appendSystemPromptOverride must stay sync; platform text is cached after first load.
      if (!cachedPlatformSystemMd) {
        throw new Error("Platform SYSTEM.md not loaded — call createPlatformResourceLoader first");
      }
      const sections = [...base, cachedPlatformSystemMd];
      if (includeBotRules) {
        if (!cachedBotSystemMd) {
          throw new Error("Platform SYSTEM_BOT.md not loaded — call createPlatformResourceLoader first");
        }
        sections.push(cachedBotSystemMd);
      }
      const security = buildSecuritySystemPrompt().trim();
      return security ? [...sections, security] : sections;
    },
  };
}

export function buildResourceLoaderOptionsForSession(
  workspacePath: string,
  agentCwd: string,
  enableSandbox: boolean,
  includeBotRules = false,
): ReturnType<typeof getPlatformResourceLoaderOptions> & {
  extensionFactories?: ReturnType<typeof createPlatformSandboxFactory>[];
} {
  const base = getPlatformResourceLoaderOptions(includeBotRules);
  if (!enableSandbox) return base;
  const sandbox = createAgentSandboxContext(workspacePath, agentCwd);
  return {
    ...base,
    extensionFactories: [createPlatformSandboxFactory(sandbox)],
  };
}

export async function createPlatformResourceLoader(
  agentCwd: string,
  agentDir: string,
  options?: PlatformResourceLoaderOptions
): Promise<DefaultResourceLoader> {
  await loadPlatformSystemMd();
  if (options?.includeBotRules) {
    await loadPlatformBotSystemMd();
  }

  let sandbox: AgentSandboxContext | undefined;
  const enableSandbox = options?.enableSandbox !== false;
  if (options?.workspacePath && enableSandbox) {
    sandbox = createAgentSandboxContext(options.workspacePath, agentCwd);
  }

  const loader = new DefaultResourceLoader({
    cwd: agentCwd,
    agentDir,
    ...(options?.includeAdminSkills ? { additionalSkillPaths: [ADMIN_SKILLS_DIR] } : {}),
    ...(sandbox ? { extensionFactories: [createPlatformSandboxFactory(sandbox)] } : {}),
    ...getPlatformResourceLoaderOptions(Boolean(options?.includeBotRules)),
  });
  await loader.reload();
  return loader;
}

/** Test helper — clears in-memory cache after SYSTEM.md edits. */
export function resetPlatformSystemCacheForTests(): void {
  cachedPlatformSystemMd = null;
  cachedBotSystemMd = null;
}
