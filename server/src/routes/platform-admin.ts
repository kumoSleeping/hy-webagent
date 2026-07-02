import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthSystem } from "../auth.js";
import type { UsageRecorder } from "../usage/recorder.js";
import { authMiddleware } from "./auth.js";
import { listModelTemplates } from "../model-policy.js";
import { listPlatformModels, parseModelFilterBody } from "../model-catalog.js";

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

/**
 * Session-authenticated admin API for the logged-in admin's AI agent.
 * Use Authorization: Bearer <sessionId> from the admin's web login.
 */
export function createPlatformAdminRouter(
  authSystem: AuthSystem,
  usageRecorder: UsageRecorder
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
    res.json({ users: authSystem.getAllUsers() });
  });

  router.get("/users/:userId", ...guard, (req, res) => {
    const user = resolveUser(authSystem, req.params.userId);
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
      res.status(201).json({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        budgetUsd: user.budgetUsd,
        budgetUsedUsd: user.budgetUsedUsd,
        modelTemplateId: user.modelTemplateId ?? null,
        workspaceDir: user.workspaceDir,
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
      const user = resolveUser(authSystem, req.params.userId);
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

  router.get("/usage", ...guard, (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : utcToday();
    res.json({ date, users: usageRecorder.getAllUsersDaily(date) });
  });

  router.get("/usage/:idOrUsername/daily", ...guard, (req, res) => {
    const user = resolveUser(authSystem, req.params.idOrUsername);
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
    const user = resolveUser(authSystem, req.params.idOrUsername);
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
      hint: "Per-model breakdown is in days[].models (keys like provider/model). Source split in days[].bySource (chat/btw/subagent).",
    });
  });

  return router;
}
