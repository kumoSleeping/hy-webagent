import { Router, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthSystem } from "../auth.js";
import type { BotRepository } from "../bot/repository.js";
import {
  ensureBotUploadCredential,
  resolveBotUserIdByUploadToken,
  storeBotUpload,
} from "../bot/uploads.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";
import type { PISessionManager } from "../pi/session-manager.js";
import { authMiddleware } from "./auth.js";

function requireBot(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).userSession?.role !== "bot") {
    res.status(403).json({ error: "Bot account required" });
    return;
  }
  next();
}

function text(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

export function createBotRouter(
  authSystem: AuthSystem,
  bots: BotRepository,
  isolator: WorkspaceIsolator,
  sessionManager: PISessionManager
): Router {
  const router = Router();
  const guard = [authMiddleware(authSystem), requireBot];

  router.post("/login", async (req, res) => {
    try {
      const apiKey = text(req.body?.apiKey, 512);
      if (!apiKey) {
        res.status(400).json({ error: "apiKey is required" });
        return;
      }
      const session = await authSystem.login(apiKey);
      const bot = bots.findAccountByUserId(session.userId);
      if (session.role !== "bot" || !bot || !bot.enabled) {
        authSystem.logout(session.sessionId);
        res.status(403).json({ error: "Bot account is disabled or invalid" });
        return;
      }
      res.json({ sessionId: session.sessionId, bot });
    } catch (error) {
      res.status(401).json({ error: (error as Error).message });
    }
  });

  router.get("/me", ...guard, (req, res) => {
    const bot = bots.findAccountByUserId((req as any).userSession.userId);
    if (!bot || !bot.enabled) {
      res.status(403).json({ error: "Bot account is disabled or invalid" });
      return;
    }
    res.json({ bot });
  });

  router.put("/channels/:channelId", ...guard, (req, res) => {
    const botUserId = (req as any).userSession.userId as string;
    const channelId = String(req.params.channelId).trim();
    if (!channelId || channelId.length > 128) {
      res.status(400).json({ error: "Invalid channelId" });
      return;
    }
    const channel = bots.upsertChannel({
      botUserId,
      channelId,
      displayName: text(req.body?.displayName) ?? null,
      platform: text(req.body?.platform, 64) ?? null,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null,
    });
    const bot = bots.findAccountByUserId(botUserId)!;
    const viewUrl = `/${encodeURIComponent(bot.slug)}/${encodeURIComponent(channelId)}`;
    res.json({ channel, viewUrl });
  });

  router.post("/sessions", ...guard, async (req, res) => {
    try {
      const botUserId = (req as any).userSession.userId as string;
      const channelId = text(req.body?.channelId, 128);
      if (!channelId) {
        res.status(400).json({ error: "channelId is required" });
        return;
      }
      if (!bots.findChannel(botUserId, channelId)) {
        bots.upsertChannel({ botUserId, channelId, displayName: null, platform: null, metadata: null });
      }
      const workspace = await isolator.ensureUserWorkspace(botUserId);
      await ensureBotUploadCredential(botUserId, workspace);
      const session = await sessionManager.createSession(botUserId, workspace, () => {});
      const now = Date.now();
      bots.createSession({
        piSessionId: session.sessionId,
        botUserId,
        channelId,
        sourceMessageId: text(req.body?.sourceMessageId, 128) ?? null,
        title: text(req.body?.title, 240) ?? null,
        status: "idle",
        createdAt: now,
        updatedAt: now,
      });
      const sourceMessageId = text(req.body?.sourceMessageId, 128);
      if (sourceMessageId) {
        bots.linkMessage({ botUserId, channelId, messageId: sourceMessageId,
          piSessionId: session.sessionId, direction: "incoming" });
      }
      res.status(201).json({
        sessionId: session.sessionId,
        viewUrl: `/${encodeURIComponent(bots.findAccountByUserId(botUserId)!.slug)}/${encodeURIComponent(channelId)}`,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/sessions/:sessionId/activate", ...guard, async (req, res) => {
    try {
      const botUserId = (req as any).userSession.userId as string;
      const record = bots.findSession(String(req.params.sessionId));
      if (!record || record.botUserId !== botUserId) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const workspace = await isolator.ensureUserWorkspace(botUserId);
      await ensureBotUploadCredential(botUserId, workspace);
      const session = await sessionManager.createSession(botUserId, workspace, () => {}, record.piSessionId);
      res.json({ sessionId: session.sessionId, status: record.status });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * Bot file upload — stores outside the agent workspace and returns a public URL.
   * Auth: bot session, or X-Bot-Upload-Token from workspace `.pi/upload.json`.
   */
  router.post(
    "/upload",
    async (req, res, next) => {
      const headerToken = String(req.headers["x-bot-upload-token"] ?? "").trim();
      const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      const token = headerToken || bodyToken;
      if (token) {
        const botUserId = await resolveBotUserIdByUploadToken(token);
        if (!botUserId) {
          res.status(401).json({ error: "Invalid upload token" });
          return;
        }
        (req as any).botUploadUserId = botUserId;
        next();
        return;
      }
      authMiddleware(authSystem)(req, res, () => requireBot(req, res, next));
    },
    async (req, res) => {
      try {
        const botUserId =
          ((req as any).botUploadUserId as string | undefined) ??
          ((req as any).userSession?.userId as string | undefined);
        if (!botUserId) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const filename = text(req.body?.filename, 240);
        const contentB64 = typeof req.body?.content_base64 === "string" ? req.body.content_base64 : "";
        const mimeType = typeof req.body?.mime_type === "string" ? req.body.mime_type : undefined;
        if (!filename || !contentB64) {
          res.status(400).json({ error: "filename and content_base64 are required" });
          return;
        }
        let content: Buffer;
        try {
          content = Buffer.from(contentB64, "base64");
        } catch {
          res.status(400).json({ error: "invalid content_base64" });
          return;
        }
        if (!content.length) {
          res.status(400).json({ error: "empty upload content" });
          return;
        }

        const stored = await storeBotUpload({ botUserId, filename, content, mimeType });
        const host = req.get("host") ?? "localhost";
        const proto = req.protocol || "http";
        const url = `${proto}://${host}${stored.publicPath}`;
        res.status(201).json({
          ok: true,
          id: stored.id,
          filename: stored.filename,
          mimeType: stored.mimeType,
          size: stored.size,
          publicPath: stored.publicPath,
          url,
        });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    },
  );

  router.post("/messages/link", ...guard, (req, res) => {
    const botUserId = (req as any).userSession.userId as string;
    const channelId = text(req.body?.channelId, 128);
    const messageId = text(req.body?.messageId, 128);
    const piSessionId = text(req.body?.piSessionId, 128);
    const record = piSessionId ? bots.findSession(piSessionId) : undefined;
    if (!channelId || !messageId || !record || record.botUserId !== botUserId || record.channelId !== channelId) {
      res.status(400).json({ error: "Invalid message link" });
      return;
    }
    bots.linkMessage({ botUserId, channelId, messageId, piSessionId: record.piSessionId,
      direction: req.body?.direction === "incoming" ? "incoming" : "outgoing" });
    res.json({ ok: true });
  });

  router.get("/messages/:channelId/:messageId", ...guard, (req, res) => {
    const botUserId = (req as any).userSession.userId as string;
    const piSessionId = bots.resolveMessage(botUserId, String(req.params.channelId), String(req.params.messageId));
    if (!piSessionId) {
      res.status(404).json({ error: "Message link not found" });
      return;
    }
    const record = bots.findSession(piSessionId);
    res.json({ piSessionId, status: record?.status ?? "unknown" });
  });

  return router;
}

export function createPublicBotRouter(bots: BotRepository, sessionManager: PISessionManager): Router {
  const router = Router();
  const dashboard = (botUserId: string, channelId: string) => {
    const bot = bots.findAccountByUserId(botUserId);
    const channel = bots.findChannel(botUserId, channelId);
    if (!bot?.enabled || !channel) return null;
    const sessions = bots.listSessions(botUserId, channelId).map((record) => ({
      piSessionId: record.piSessionId,
      sourceMessageId: record.sourceMessageId,
      title: record.title,
      status: sessionManager.isAgentRunning(record.piSessionId) ? "running" : record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      viewUrl: `/${encodeURIComponent(bot.slug)}/${encodeURIComponent(channelId)}`,
    }));
    return {
      bot: { slug: bot.slug, displayName: bot.displayName },
      channel: { channelId: channel.channelId, displayName: channel.displayName, platform: channel.platform },
      sessions,
      activeCount: sessions.filter((session) => session.status === "running").length,
    };
  };

  router.get("/channels/:channelId/sessions/:sessionId", (req, res) => {
    const record = bots.findSession(String(req.params.sessionId));
    if (!record || record.channelId !== String(req.params.channelId)) {
      res.status(404).json({ error: "Group session not found" });
      return;
    }
    const result = dashboard(record.botUserId, record.channelId);
    if (!result) {
      res.status(404).json({ error: "Group session not found" });
      return;
    }
    res.json(result);
  });

  router.get("/:slug/channels/:channelId", (req, res) => {
    const bot = bots.findAccountBySlug(String(req.params.slug));
    if (!bot || !bot.enabled) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const channel = bots.findChannel(bot.userId, String(req.params.channelId));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.json(dashboard(bot.userId, channel.channelId));
  });
  return router;
}

interface SavedGroupConfig {
  version: 1;
  groups: Array<{ botSlug: string; channelId: string }>;
}

export function createSavedGroupRouter(
  authSystem: AuthSystem,
  bots: BotRepository,
  isolator: WorkspaceIsolator,
): Router {
  const router = Router();
  const guard = authMiddleware(authSystem);
  const configPath = (userId: string) => path.join(isolator.getVisibleRoot(userId), "saved-groups.json");

  const readConfig = async (userId: string): Promise<SavedGroupConfig> => {
    const filePath = configPath(userId);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
      const groups = Array.isArray(parsed?.groups)
        ? parsed.groups.filter((item: any) => typeof item?.botSlug === "string" && typeof item?.channelId === "string")
        : [];
      return { version: 1, groups };
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw new Error("saved-groups.json 格式无效，请在 Workspace 中修复");
      const empty: SavedGroupConfig = { version: 1, groups: [] };
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(empty, null, 2)}\n`, "utf-8");
      return empty;
    }
  };

  const writeConfig = async (userId: string, config: SavedGroupConfig) => {
    const filePath = configPath(userId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  };

  const describe = (botUserId: string, channelId: string) => {
    const channel = bots.findChannel(botUserId, channelId);
    const bot = bots.findAccountByUserId(botUserId);
    if (!channel) return null;
    const latest = bots.listSessions(channel.botUserId, channel.channelId)[0];
    if (!bot?.enabled || !latest) return null;
    return {
      channelId: channel.channelId,
      botSlug: bot.slug,
      displayName: channel.displayName,
      botDisplayName: bot.displayName,
      latestSessionId: latest.piSessionId,
      viewUrl: `/${encodeURIComponent(bot.slug)}/${encodeURIComponent(channel.channelId)}`,
    };
  };

  router.get("/", guard, async (req, res) => {
    const userId = (req as any).userSession.userId as string;
    try {
      const config = await readConfig(userId);
      const groups = config.groups.map((saved) => {
        const bot = bots.findAccountBySlug(saved.botSlug);
        return bot ? describe(bot.userId, saved.channelId) : null;
      }).filter(Boolean);
      res.json({ groups, configFile: "saved-groups.json" });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/", guard, async (req, res) => {
    const channelId = text(req.body?.channelId, 128);
    const botSlug = text(req.body?.botSlug, 64)?.toLowerCase();
    if (!channelId || !botSlug) {
      res.status(400).json({ error: "botSlug and channelId are required" });
      return;
    }
    const bot = bots.findAccountBySlug(botSlug);
    const group = bot ? describe(bot.userId, channelId) : null;
    if (!group) {
      res.status(404).json({ error: "找不到该群聊，或群内还没有会话" });
      return;
    }
    try {
      const userId = (req as any).userSession.userId as string;
      const config = await readConfig(userId);
      const exists = config.groups.some((item) => item.botSlug.toLowerCase() === botSlug && item.channelId === channelId);
      if (!exists) config.groups.unshift({ botSlug, channelId });
      await writeConfig(userId, config);
      res.status(201).json({ group, configFile: "saved-groups.json" });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  return router;
}
