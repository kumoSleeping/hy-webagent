import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserAccount } from "./types.js";

export interface ModelAllowRule {
  provider: string;
  modelId: string;
}

export interface ModelTemplate {
  label: string;
  description: string;
  allow: ModelAllowRule[] | null;
  providers: string[] | null;
}

export interface ModelTemplateCatalog {
  templates: Record<string, ModelTemplate>;
}

export interface ModelRefLike {
  provider: string;
  id: string;
  name?: string;
}

export interface ResolvedModelPolicy {
  templateId: string | null;
  /** No allowlist filtering — current default behavior. */
  unrestricted: boolean;
  allow: ModelAllowRule[] | null;
  /** Platform providers whose keys may be injected at session start. */
  providers: string[] | null;
}

const CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../config/model-templates.json"
);

let cachedCatalog: ModelTemplateCatalog | null = null;

function loadCatalog(): ModelTemplateCatalog {
  if (cachedCatalog) return cachedCatalog;
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  cachedCatalog = JSON.parse(raw) as ModelTemplateCatalog;
  return cachedCatalog;
}

export function resetModelTemplateCatalogForTests(): void {
  cachedCatalog = null;
}

export function listModelTemplates(): Array<{ id: string } & ModelTemplate> {
  const catalog = loadCatalog();
  return Object.entries(catalog.templates).map(([id, template]) => ({ id, ...template }));
}

export function getModelTemplate(templateId: string): ModelTemplate | undefined {
  return loadCatalog().templates[templateId];
}

export function assertValidModelTemplateId(templateId: string): void {
  if (!getModelTemplate(templateId)) {
    throw new Error(`Unknown model template: ${templateId}`);
  }
}

export function normalizeModelTemplateId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "full") return null;
  return trimmed;
}

export function resolveModelPolicy(
  user: Pick<UserAccount, "modelTemplateId" | "modelAllow"> | undefined,
  isAdmin: boolean
): ResolvedModelPolicy {
  if (isAdmin) {
    return { templateId: null, unrestricted: true, allow: null, providers: null };
  }

  if (user?.modelAllow != null && user.modelAllow.length > 0) {
    const providers = [...new Set(user.modelAllow.map((rule) => rule.provider))];
    return {
      templateId: null,
      unrestricted: false,
      allow: user.modelAllow,
      providers,
    };
  }

  const templateId = normalizeModelTemplateId(user?.modelTemplateId);
  if (!templateId) {
    return { templateId: null, unrestricted: true, allow: null, providers: null };
  }

  const template = getModelTemplate(templateId);
  if (!template) {
    return { templateId: null, unrestricted: true, allow: null, providers: null };
  }

  return {
    templateId,
    unrestricted: false,
    allow: template.allow,
    providers: template.providers,
  };
}

export function isModelAllowed(
  policy: ResolvedModelPolicy,
  provider: string,
  modelId: string
): boolean {
  if (policy.unrestricted || !policy.allow) return true;
  return policy.allow.some((rule) => {
    if (rule.provider !== provider) return false;
    return rule.modelId === "*" || rule.modelId === modelId;
  });
}

export function filterModels<T extends ModelRefLike>(policy: ResolvedModelPolicy, models: T[]): T[] {
  if (policy.unrestricted || !policy.allow) return models;
  return models.filter((m) => isModelAllowed(policy, m.provider, m.id));
}

export function modelPolicyError(provider: string, modelId: string, templateId: string | null): string {
  const label = templateId ?? "custom filter";
  return `Model ${provider}/${modelId} is not allowed by ${label}`;
}
