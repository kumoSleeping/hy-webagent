// ============================================================
// PI Web Platform - Slash Command: Model Handlers
// ============================================================

import type { SlashContext, SlashResponse } from "./types.js";

function getUserSession(ctx: SlashContext) {
  const ps = ctx.activeSessionId
    ? ctx.sessionManager.getSession(ctx.activeSessionId)
    : ctx.sessionManager.getSessionForUser(ctx.userId);
  if (!ps) throw new Error("No active PI session");
  return ps;
}

export async function setModel(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const provider = args.provider as string | undefined;
  const modelId = args.modelId as string | undefined;
  if (!provider || !modelId) {
    return { ok: false, message: "provider and modelId are required" };
  }

  const ps = getUserSession(ctx);
  const model = ps.session.modelRegistry.find(provider, modelId);
  if (!model) {
    return { ok: false, message: `Model not found: ${provider}/${modelId}` };
  }

  await ps.session.setModel(model);
  const levels = ps.session.getAvailableThinkingLevels();
  const maxLevel = levels[levels.length - 1];
  if (maxLevel) {
    ps.session.setThinkingLevel(maxLevel as Parameters<typeof ps.session.setThinkingLevel>[0]);
  }
  return {
    ok: true,
    data: {
      provider,
      modelId,
      name: (model as any).name,
      thinkingLevel: ps.session.thinkingLevel,
    },
    message: `Model set to ${provider}/${modelId}`,
  };
}

export async function cycleModel(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const direction = (args.direction as "forward" | "backward") || "forward";
  const ps = getUserSession(ctx);
  const result = await ps.session.cycleModel(direction);
  if (!result) {
    return { ok: true, data: null, message: "No other model available" };
  }
  return {
    ok: true,
    data: {
      provider: result.model.provider,
      modelId: result.model.id,
      thinkingLevel: result.thinkingLevel,
      isScoped: result.isScoped,
    },
    message: `Cycled to ${result.model.provider}/${result.model.id}`,
  };
}

export async function setScopedModels(
  ctx: SlashContext,
  args: Record<string, unknown>
): Promise<SlashResponse> {
  const modelsArg = args.models;
  if (!Array.isArray(modelsArg)) {
    return { ok: false, message: "models array is required" };
  }

  const ps = getUserSession(ctx);
  const scoped: { model: any; thinkingLevel?: string }[] = [];

  for (const entry of modelsArg) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: "Each model entry must be an object" };
    }
    const e = entry as Record<string, unknown>;
    const provider = e.provider as string | undefined;
    const modelId = e.modelId as string | undefined;
    if (!provider || !modelId) {
      return { ok: false, message: "Each model entry needs provider and modelId" };
    }
    const model = ps.session.modelRegistry.find(provider, modelId);
    if (!model) {
      return { ok: false, message: `Model not found: ${provider}/${modelId}` };
    }
    scoped.push({
      model,
      thinkingLevel: e.thinkingLevel as string | undefined,
    });
  }

  ps.session.setScopedModels(scoped as any);
  return {
    ok: true,
    data: scoped.map((s) => ({
      provider: s.model.provider,
      modelId: s.model.id,
      thinkingLevel: s.thinkingLevel,
    })),
    message: `Set ${scoped.length} scoped model(s)`,
  };
}
