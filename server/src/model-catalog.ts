import path from "node:path";
import {
  ModelRuntime,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { ModelAllowRule } from "./model-policy.js";

export interface PlatformModelEntry {
  /** Stable id for filters: `provider/modelId` */
  key: string;
  provider: string;
  modelId: string;
  /** Human-readable model label shown in the UI */
  name: string;
  /** Human-readable provider label */
  providerName: string;
}

let cachedRuntime: Promise<ModelRuntime> | null = null;

function platformModelsJsonPath(): string {
  return path.join(getAgentDir(), "models.json");
}

function getRuntime(): Promise<ModelRuntime> {
  if (!cachedRuntime) {
    cachedRuntime = ModelRuntime.create({
      authPath: path.join(getAgentDir(), "auth.json"),
      modelsPath: platformModelsJsonPath(),
    });
  }
  return cachedRuntime;
}

export function resetModelCatalogCacheForTests(): void {
  cachedRuntime = null;
}

/** All platform-known models (built-in + models.json), regardless of auth. */
export async function listPlatformModels(): Promise<PlatformModelEntry[]> {
  const runtime = await getRuntime();
  return runtime
    .getModels()
    .map((model) => ({
      key: `${model.provider}/${model.id}`,
      provider: model.provider,
      modelId: model.id,
      name: model.name?.trim() || model.id,
      providerName: runtime.getProvider(model.provider)?.name?.trim() || model.provider,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function parseModelKey(key: string): { provider: string; modelId: string } {
  const trimmed = key.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`Invalid model key "${key}" — expected provider/modelId`);
  }
  return {
    provider: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

export async function assertKnownModelRules(rules: ModelAllowRule[]): Promise<void> {
  const known = new Set((await listPlatformModels()).map((m) => m.key));
  for (const rule of rules) {
    if (rule.modelId === "*") continue;
    const key = `${rule.provider}/${rule.modelId}`;
    if (!known.has(key)) {
      throw new Error(`Unknown model: ${key}`);
    }
  }
}

export async function parseModelFilterBody(body: unknown): Promise<ModelAllowRule[] | null> {
  if (body === null || body === undefined) {
    throw new Error("Request body required");
  }
  if (typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const record = body as Record<string, unknown>;

  if (record.allow === null || record.models === null) {
    return null;
  }

  if (record.models !== undefined) {
    if (!Array.isArray(record.models)) {
      throw new Error("models must be an array of provider/modelId strings");
    }
    const rules = record.models.map((entry) => {
      if (typeof entry !== "string") {
        throw new Error("Each models entry must be a string like deepseek/deepseek-v4-flash");
      }
      const { provider, modelId } = parseModelKey(entry);
      return { provider, modelId };
    });
    await assertKnownModelRules(rules);
    if (rules.length === 0) {
      throw new Error("models must include at least one entry (use allow:null to clear filter)");
    }
    return rules;
  }

  if (record.allow !== undefined) {
    if (!Array.isArray(record.allow)) {
      throw new Error("allow must be an array of { provider, modelId } rules");
    }
    const rules: ModelAllowRule[] = record.allow.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`allow[${index}] must be an object`);
      }
      const rule = entry as Record<string, unknown>;
      if (typeof rule.provider !== "string" || !rule.provider.trim()) {
        throw new Error(`allow[${index}].provider is required`);
      }
      if (typeof rule.modelId !== "string" || !rule.modelId.trim()) {
        throw new Error(`allow[${index}].modelId is required`);
      }
      return { provider: rule.provider.trim(), modelId: rule.modelId.trim() };
    });
    await assertKnownModelRules(rules);
    if (rules.length === 0) {
      throw new Error("allow must include at least one rule (use allow:null to clear filter)");
    }
    return rules;
  }

  throw new Error('Body must include "models" or "allow" (or null to clear filter)');
}
