import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** PI built-in provider id → environment variable (subset used by templates). */
const PROVIDER_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  jina: "JINA_API_KEY",
};

/** Providers always injected at runtime from host auth/env — never written to user auth.json. */
export const SHARED_RUNTIME_PROVIDERS = ["jina"] as const;

let cachedGlobalAuth: Record<string, { type?: string; key?: string }> | null | undefined;

function globalAuthPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "auth.json");
}

function readGlobalAuthJsonFromDisk(): Record<string, { type?: string; key?: string }> | null {
  try {
    return JSON.parse(fs.readFileSync(globalAuthPath(), "utf-8")) as Record<
      string,
      { type?: string; key?: string }
    >;
  } catch {
    return null;
  }
}

function loadGlobalAuthJson(): Record<string, { type?: string; key?: string }> | null {
  if (cachedGlobalAuth !== undefined) return cachedGlobalAuth;
  cachedGlobalAuth = readGlobalAuthJsonFromDisk();
  return cachedGlobalAuth;
}

export function invalidatePlatformCredentialsCache(): void {
  cachedGlobalAuth = undefined;
}

export function resetPlatformCredentialsCacheForTests(): void {
  invalidatePlatformCredentialsCache();
}

export function loadPlatformProviderKey(provider: string): string | undefined {
  const envVar = PROVIDER_ENV[provider];
  if (envVar) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv) return fromEnv;
  }

  const auth = loadGlobalAuthJson();
  const cred = auth?.[provider];
  if (cred?.type === "api_key" && typeof cred.key === "string" && cred.key.trim()) {
    return cred.key.trim();
  }
  return undefined;
}

function loadPlatformProviderKeyFromSource(
  provider: string,
  auth: Record<string, { type?: string; key?: string }> | null
): string | undefined {
  const envVar = PROVIDER_ENV[provider];
  if (envVar) {
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv) return fromEnv;
  }
  const cred = auth?.[provider];
  if (cred?.type === "api_key" && typeof cred.key === "string" && cred.key.trim()) {
    return cred.key.trim();
  }
  return undefined;
}

/** Inject runtime keys for template providers — never written to user workspace auth.json. */
export async function injectRuntimeProviderKeys(
  modelRuntime: ModelRuntime,
  providers: string[] | null | undefined
): Promise<string[]> {
  if (!providers?.length) return [];
  const injected: string[] = [];
  const auth = loadGlobalAuthJson();
  for (const provider of providers) {
    const key = loadPlatformProviderKeyFromSource(provider, auth);
    if (!key) continue;
    await modelRuntime.setRuntimeApiKey(provider, key);
    injected.push(provider);
  }
  return injected;
}

/** Inject shared platform keys (e.g. Jina search) into every live session. */
export async function injectSharedProviderKeys(modelRuntime: ModelRuntime): Promise<string[]> {
  invalidatePlatformCredentialsCache();
  const auth = readGlobalAuthJsonFromDisk();
  const injected: string[] = [];
  for (const provider of SHARED_RUNTIME_PROVIDERS) {
    const key = loadPlatformProviderKeyFromSource(provider, auth);
    if (!key) continue;
    await modelRuntime.setRuntimeApiKey(provider, key);
    injected.push(provider);
  }
  return injected;
}
