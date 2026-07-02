import { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthSystem } from "../auth.js";
import { generateApiKey } from "../auth.js";
import type { UsageRecorder } from "../usage/recorder.js";
import { ADMIN_SKILLS_DIR } from "../pi/platform-system.js";
import { listModelTemplates } from "../model-policy.js";

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function resolveUser(authSystem: AuthSystem, idOrUsername: string) {
  const byId = authSystem.getUser(idOrUsername);
  if (byId) return byId;
  return authSystem.findUserByUsername(idOrUsername);
}

async function listAdminSkillNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(ADMIN_SKILLS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

import type { PISessionManager } from "../pi/session-manager.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";

export function createAdminRouter(
  authSystem: AuthSystem,
  usageRecorder: UsageRecorder,
  sessionManager: PISessionManager,
  isolator: WorkspaceIsolator
): Router {
  const router = Router();

  router.post("/users", async (req: Request, res: Response) => {
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

  router.get("/users", (_req, res) => {
    res.json({ users: authSystem.getAllUsers() });
  });

  router.get("/users/:userId", (req, res) => {
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

  router.get("/model-templates", (_req, res) => {
    res.json({ templates: listModelTemplates() });
  });

  router.patch("/users/:userId", (req, res) => {
    try {
      const existing = resolveUser(authSystem, routeParam(req.params.userId));
      if (!existing) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const user = authSystem.updateUser(existing.userId, req.body ?? {});
      res.json({
        user,
        adminSkillsSynced: user.role === "admin",
        note:
          user.role === "admin"
            ? "Active agent sessions reloaded with admin-skills/. New logins pick up admin skills on next chat."
            : undefined,
      });
    } catch (err) {
      const message = (err as Error).message;
      res.status(message === "User not found" ? 404 : 400).json({ error: message });
    }
  });

  router.delete("/users/:userId", (req, res) => {
    try {
      const existing = resolveUser(authSystem, routeParam(req.params.userId));
      if (!existing) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      authSystem.deleteUser(existing.userId);
      res.json({ ok: true });
    } catch (err) {
      const message = (err as Error).message;
      res.status(message === "User not found" ? 404 : 400).json({ error: message });
    }
  });

  router.post("/users/:userId/rotate-key", async (req, res) => {
    try {
      const existing = resolveUser(authSystem, routeParam(req.params.userId));
      if (!existing) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const result = await authSystem.rotateApiKey(existing.userId);
      res.json(result);
    } catch (err) {
      const message = (err as Error).message;
      res.status(message === "User not found" ? 404 : 400).json({ error: message });
    }
  });

  router.post("/users/:userId/add-budget", (req, res) => {
    try {
      const existing = resolveUser(authSystem, routeParam(req.params.userId));
      if (!existing) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const amountUsd = Number(req.body?.amountUsd);
      const user = authSystem.addBudget(existing.userId, amountUsd);
      res.json({ user, addedUsd: amountUsd });
    } catch (err) {
      const message = (err as Error).message;
      res.status(message === "User not found" ? 404 : 400).json({ error: message });
    }
  });

  router.post("/users/:userId/sync-credentials", async (req, res) => {
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
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/usage", (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : utcToday();
    res.json({ date, users: usageRecorder.getAllUsersDaily(date) });
  });

  router.get("/usage/:userId", (req, res) => {
    const user = resolveUser(authSystem, routeParam(req.params.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const from = typeof req.query.from === "string" ? req.query.from : utcToday();
    const to = typeof req.query.to === "string" ? req.query.to : from;
    res.json({
      userId: user.userId,
      displayName: user.displayName,
      from,
      to,
      days: usageRecorder.getRange(user.userId, from, to),
    });
  });

  router.get("/usage/:userId/daily", (req, res) => {
    const user = resolveUser(authSystem, routeParam(req.params.userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ userId: user.userId, dates: usageRecorder.listDailyDates(user.userId) });
  });

  router.get("/skills", async (_req, res) => {
    res.json({ skills: await listAdminSkillNames(), root: ADMIN_SKILLS_DIR });
  });

  router.get("/skills/:name", async (req, res) => {
    const skillDir = path.join(ADMIN_SKILLS_DIR, req.params.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    try {
      const content = await fs.readFile(skillFile, "utf-8");
      res.json({ name: req.params.name, path: skillFile, content });
    } catch {
      res.status(404).json({ error: "Skill not found" });
    }
  });

  return router;
}

/** @deprecated Use POST /api/admin/users with Authorization header instead. */
export function createLegacyAdminUserRoute(authSystem: AuthSystem): Router {
  const router = Router();
  router.post("/legacy/admin/users", async (req, res) => {
    try {
      const { adminKey, apiKey, displayName, username } = req.body ?? {};
      const { config } = await import("../config.js");
      const { matchesMasterAdminKey } = await import("../admin-key.js");
      if (!matchesMasterAdminKey(String(adminKey ?? ""), config.adminKey)) {
        res.status(403).json({ error: "Invalid admin key" });
        return;
      }
      const key = apiKey || generateApiKey();
      const { user, plainKey } = await authSystem.createUser(key, displayName || "User", {
        username: typeof username === "string" ? username : undefined,
      });
      res.status(201).json({
        userId: user.userId,
        displayName: user.displayName,
        username: user.username,
        plainKey,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  return router;
}
