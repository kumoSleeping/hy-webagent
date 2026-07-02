import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthStorage } from "@earendil-works/pi-coding-agent";

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

let cachedGlobalAuth: Record<string, { type?: string; key?: string }> | null | undefined;

function loadGlobalAuthJson(): Record<string, { type?: string; key?: string }> | null {
  if (cachedGlobalAuth !== undefined) return cachedGlobalAuth;
  const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
  try {
    cachedGlobalAuth = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<
      string,
      { type?: string; key?: string }
    >;
  } catch {
    cachedGlobalAuth = null;
  }
  return cachedGlobalAuth;
}

export function resetPlatformCredentialsCacheForTests(): void {
  cachedGlobalAuth = undefined;
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

/** Inject runtime keys for template providers — never written to user workspace auth.json. */
export function injectRuntimeProviderKeys(
  authStorage: AuthStorage,
  providers: string[] | null | undefined
): string[] {
  if (!providers?.length) return [];
  const injected: string[] = [];
  for (const provider of providers) {
    const key = loadPlatformProviderKey(provider);
    if (!key) continue;
    authStorage.setRuntimeApiKey(provider, key);
    injected.push(provider);
  }
  return injected;
}
