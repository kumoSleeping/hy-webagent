import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthSystem } from "../auth.js";
import type { UsageRecorder } from "../usage/recorder.js";
import { authMiddleware } from "./auth.js";
import { listModelTemplates } from "../model-policy.js";
import { listPlatformModels, parseModelFilterBody } from "../model-catalog.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";
import type { PISessionManager } from "../pi/session-manager.js";
import type { BotRepository } from "../bot/repository.js";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).userSession;
  if (!session || session.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}

function resolveUser(authSystem: AuthSystem, idOrUsername: string) {
  const byId = authSystem.getUser(idOrUsername);
  if (byId) return byId;
  return authSystem.findUserByUsername(idOrUsername);
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Session-authenticated admin API for the logged-in admin's AI agent.
 * Use Authorization: Bearer <sessionId> from the admin's web login.
 */
export function createPlatformAdminRouter(
  authSystem: AuthSystem,
  usageRecorder: UsageRecorder,
  isolator: WorkspaceIsolator,
  sessionManager: PISessionManager,
  bots: BotRepository
): Router {
  const router = Router();
  const guard = [authMiddleware(authSystem), requireAdminRole];

  router.get("/context", ...guard, (req: Request, res: Response) => {
    const session = (req as any).userSession;
    const host = req.get("host") ?? "localhost:3001";
    const baseUrl = `${req.protocol}://${host}`;
    const platformAdminBase = `${baseUrl}/api/platform/admin`;
    res.json({
      userId: session.userId,
      displayName: session.displayName,
      role: session.role,
      sessionId: session.sessionId,
      platformAdminBase,
      adminApiBase: `${baseUrl}/api/admin`,
      authHeader: `Authorization: Bearer ${session.sessionId}`,
      endpoints: {
        credential: `${platformAdminBase}/credential`,
        users: `${platformAdminBase}/users`,
        usageAll: `${platformAdminBase}/usage`,
        usageUser: `${platformAdminBase}/usage/{userIdOrUsername}`,
        usageUserDaily: `${platformAdminBase}/usage/{userIdOrUsername}/daily`,
        models: `${platformAdminBase}/models`,
        userModelFilter: `${platformAdminBase}/users/{userIdOrUsername}/model-filter`,
        syncCredentials: `${platformAdminBase}/users/{userIdOrUsername}/sync-credentials`,
        bots: `${platformAdminBase}/bots`,
      },
      examples: {
        listUsers: `curl -s -H "Authorization: Bearer ${session.sessionId}" "${platformAdminBase}/users"`,
        listModels: `curl -s -H "Authorization: Bearer ${session.sessionId}" "${platformAdminBase}/models"`,
        aliceUsageToday: `curl -s -H "Authorization: Bearer ${session.sessionId}" "${platformAdminBase}/usage/alice?from=${utcToday()}&to=${utcToday()}"`,
        aliceModelFilter: `curl -s -X PUT -H "Authorization: Bearer ${session.sessionId}" -H "Content-Type: application/json" -d '{"models":["deepseek/deepseek-v4-flash"]}' "${platformAdminBase}/users/alice/model-filter"`,
      },
    });
  });

  router.get("/credential", ...guard, (req: Request, res: Response) => {
    const userId = (req as any).userSession.userId as string;
    const apiKey = authSystem.getStoredApiKey(userId);
    if (!apiKey) {
      res.status(404).json({
        error: "No stored API key for this admin. Run bootstrap or rotate-key to populate the database.",
      });
      return;
    }
    res.json({ userId, apiKey });
  });

  router.get("/users", ...guard, (_req, res) => {
    res.json({ users: authSystem.getAllUsers().filter((user) => user.role !== "bot") });
  });

  router.get("/bots", ...guard, (_req, res) => {
    res.json({ bots: bots.listAccounts().map((bot) => ({ ...bot, channels: bots.listChannels(bot.userId) })) });
  });

  router.post("/bots", ...guard, async (req, res) => {
    try {
      const slug = typeof req.body?.slug === "string" ? req.body.slug.trim().toLowerCase() : "";
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
        res.status(400).json({ error: "slug must be 2-63 lowercase letters, numbers, or hyphens" });
        return;
      }
      if (!displayName) {
        res.status(400).json({ error: "displayName is required" });
        return;
      }
      if (bots.findAccountBySlug(slug)) {
        res.status(409).json({ error: `Bot already exists: ${slug}` });
        return;
      }
      const { user, plainKey } = await authSystem.createUser(undefined, displayName, {
        username: `bot-${slug}`,
        role: "bot",
        budgetUsd: typeof req.body?.budgetUsd === "number" ? req.body.budgetUsd : undefined,
        modelTemplateId: typeof req.body?.modelTemplateId === "string" ? req.body.modelTemplateId : undefined,
      });
      const now = Date.now();
      bots.createAccount({ userId: user.userId, slug, displayName, enabled: true, createdAt: now, updatedAt: now });
      const workspacePath = await isolator.ensureUserWorkspace(user.userId);
      await sessionManager.syncUserAgentCredentials(user.userId, workspacePath);
      res.status(201).json({ bot: bots.findAccountByUserId(user.userId), apiKey: plainKey,
        note: "Store this API key now. It is returned only on creation or rotation." });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.patch("/bots/:slug", ...guard, (req, res) => {
    try {
      const bot = bots.findAccountBySlug(routeParam(req.params.slug));
      if (!bot) {
        res.status(404).json({ error: "Bot not found" });
        return;
      }
      const patch: { displayName?: string; enabled?: boolean } = {};
      if (typeof req.body?.displayName === "string" && req.body.displayName.trim()) patch.displayName = req.body.displayName.trim();
      if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
      const updated = bots.updateAccount(bot.userId, patch);
      if (patch.displayName) authSystem.updateUser(bot.userId, { displayName: patch.displayName });
      res.json({ bot: updated });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/bots/:slug/rotate-key", ...guard, async (req, res) => {
    const bot = bots.findAccountBySlug(routeParam(req.params.slug));
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const result = await authSystem.rotateApiKey(bot.userId);
    res.json({ bot, apiKey: result.plainKey,
      note: "Replace the old key in the bot configuration. Existing bot sessions were revoked." });
  });

  router.get("/bots/:slug/channels", ...guard, (req, res) => {
    const bot = bots.findAccountBySlug(routeParam(req.params.slug));
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    res.json({ bot, channels: bots.listChannels(bot.userId) });
  });

  router.get("/users/:userId", ...guard, (req, res) => {
    const user = resolveUser(authSystem, routeParam(req.params.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const { apiKeyHash: _, ...publicUser } = user;
    res.json({
      user: { ...publicUser, username: user.username ?? user.displayName },
      usageToday: usageRecorder.getDaily(user.userId, utcToday()),
    });
  });

  router.post("/users", ...guard, async (req, res) => {
    try {
      const { apiKey, displayName, username, role, budgetUsd, modelTemplateId } = req.body ?? {};
      if (!displayName || typeof displayName !== "string") {
        res.status(400).json({ error: "displayName is required" });
        return;
      }
      const { user, plainKey } = await authSystem.createUser(apiKey, displayName, {
        username: typeof username === "string" ? username : undefined,
        role: role === "admin" ? "admin" : "user",
        budgetUsd:
          typeof budgetUsd === "number" || budgetUsd === null ? budgetUsd : undefined,
        modelTemplateId:
          typeof modelTemplateId === "string" || modelTemplateId === null
            ? modelTemplateId
            : undefined,
      });
      const workspacePath = await isolator.ensureUserWorkspace(user.userId);
      const liveSessionsUpdated = await sessionManager.syncUserAgentCredentials(
        user.userId,
        workspacePath
      );
      res.status(201).json({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        budgetUsd: user.budgetUsd,
        budgetUsedUsd: user.budgetUsedUsd,
        modelTemplateId: user.modelTemplateId ?? null,
        workspaceDir: user.workspaceDir,
        workspacePath,
        credentialsSynced: true,
        liveSessionsUpdated,
        plainKey,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/model-templates", ...guard, (_req, res) => {
    res.json({ templates: listModelTemplates() });
  });

  router.get("/models", ...guard, (_req, res) => {
    const models = listPlatformModels();
    res.json({
      models,
      hint: "Use PUT /users/{username}/model-filter with { models: [\"provider/modelId\", ...] } or { allow: null } to clear.",
    });
  });

  router.put("/users/:userId/model-filter", ...guard, (req, res) => {
    try {
      const user = resolveUser(authSystem, routeParam(req.params.userId));
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const allow = parseModelFilterBody(req.body);
      const updated = authSystem.updateUser(user.userId, {
        modelAllow: allow ?? undefined,
        ...(allow ? { modelTemplateId: null } : {}),
      });

      res.json({
        ok: true,
        user: updated,
        modelAllow: updated.modelAllow ?? null,
        models: (updated.modelAllow ?? []).map((rule) => `${rule.provider}/${rule.modelId}`),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/users/:userId/sync-credentials", ...guard, async (req, res) => {
    try {
      const user = resolveUser(authSystem, routeParam(req.params.userId));
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const workspacePath = await isolator.ensureUserWorkspace(user.userId);
      const liveSessionsUpdated = await sessionManager.syncUserAgentCredentials(
        user.userId,
        workspacePath
      );
      res.json({
        ok: true,
        userId: user.userId,
        username: user.username ?? user.displayName,
        workspacePath,
        liveSessionsUpdated,
        note:
          liveSessionsUpdated > 0
            ? "Active chat sessions refreshed with platform credentials (Jina search, etc.)."
            : "Workspace auth.json updated; user will pick up credentials on next chat session.",
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/usage", ...guard, (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : utcToday();
    res.json({ date, users: usageRecorder.getAllUsersDaily(date) });
  });

  router.get("/usage/:idOrUsername/daily", ...guard, (req, res) => {
    const user = resolveUser(authSystem, routeParam(req.params.idOrUsername));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      userId: user.userId,
      username: user.username ?? user.displayName,
      displayName: user.displayName,
      dates: usageRecorder.listDailyDates(user.userId),
    });
  });

  router.get("/usage/:idOrUsername", ...guard, (req, res) => {
    const user = resolveUser(authSystem, routeParam(req.params.idOrUsername));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : utcToday();
    const to = typeof req.query.to === "string" ? req.query.to : from;
    const days = usageRecorder.getRange(user.userId, from, to);
    res.json({
      userId: user.userId,
      username: user.username ?? user.displayName,
      displayName: user.displayName,
      from,
      to,
      days,
      hint: "Per-model breakdown is in days[].models (keys like provider/model). Source split in days[].bySource (chat/subagent).",
    });
  });

  return router;
}
