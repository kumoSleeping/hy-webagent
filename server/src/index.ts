import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import cors from "cors";
import compression from "compression";
import { AuthSystem, generateApiKey, budgetSnapshot } from "./auth.js";
import { createAuthRouter, authMiddleware } from "./routes/auth.js";
import { adminAuthMiddleware } from "./middleware/admin-auth.js";
import { createAdminRouter, createLegacyAdminUserRoute } from "./routes/admin.js";
import { UsageRecorder } from "./usage/recorder.js";
import { WorkspaceIsolator } from "./pi/isolation.js";
import { PISessionManager } from "./pi/session-manager.js";
import { TokenTracker } from "./pi/token-tracker.js";
import { config } from "./config.js";
import { handleChatWs } from "./ws/chat.js";
import { createFilesRouter } from "./routes/files.js";
import { BrowserMessageRenderer, resolveCardDistDir } from "./render/browser-message-renderer.js";
import { createMessageRenderHandler } from "./routes/message-render.js";
import { createPlatformAdminRouter } from "./routes/platform-admin.js";
import path from "node:path";
import { findSessionFilePath } from "./pi/session-files.js";
import fs from "node:fs/promises";
import { loadPlatformSystemMd, loadPlatformBotSystemMd } from "./pi/platform-system.js";
import logger, { createLogger } from "./logger.js";
import { getAdminApiCatalog } from "./admin/catalog.js";
import { titleFromUserMessage } from "./attachment-display.js";
import { printFirstAdminKeyNotice } from "./admin-key.js";
import { resolveModelPolicy } from "./model-policy.js";
import helmet from "helmet";
import { attachRequestId, errorHandler } from "./middleware/error-handler.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { isWebSocketOriginAllowed, isOriginAllowed } from "./ws-origin.js";
import { attachClientStatic } from "./client-static.js";
import { BotRepository } from "./bot/repository.js";
import { createBotRouter, createPublicBotRouter, createSavedGroupRouter } from "./routes/bot.js";
import { loadBotUpload } from "./bot/uploads.js";

const log = createLogger("server");
const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(attachRequestId);
app.use(cors({
  origin(origin, callback) {
    if (!origin || isOriginAllowed(origin)) {
      callback(null, origin ?? true);
      return;
    }
    callback(null, false);
  },
}));
// Bot uploads carry base64 payloads up to ~20MB; parse that route with a higher cap.
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/bot/upload") {
    express.json({ limit: "25mb" })(req, res, next);
    return;
  }
  express.json({ limit: "1mb" })(req, res, next);
});
app.use(compression());
app.use("/api", (req, res, next) => {
  if (req.path === "/auth/login" || req.path === "/auth/me" || req.path === "/auth/logout") {
    next();
    return;
  }
  apiRateLimiter(req, res, next);
});

// --- Core Services ---
const authSystem = new AuthSystem();
const isolator = new WorkspaceIsolator(authSystem);
const sessionManager = new PISessionManager(
  (userId) => authSystem.isAdmin(userId),
  (userId) => {
    const user = authSystem.getUser(userId);
    return resolveModelPolicy(user, authSystem.isAdmin(userId));
  },
  config.maxConcurrentUsers,
  (userId) => authSystem.getUser(userId)?.role === "bot",
);
authSystem.onUserRoleChanged(async (userId) => {
  if (authSystem.isAdmin(userId)) {
    await sessionManager.syncUserPrivileges(userId);
  }
});
authSystem.onUserModelTemplateChanged(async (userId) => {
  await sessionManager.syncUserModelPolicy(userId);
});

const tokenTracker = new TokenTracker();
const usageRecorder = new UsageRecorder();
const botRepository = new BotRepository(config.databasePath);
const messageRenderer = new BrowserMessageRenderer(`http://127.0.0.1:${config.port}`);

// HYW card-ui static assets (Playwright render target for download + bot).
app.use("/__render/card", express.static(resolveCardDistDir(), {
  index: "index.html",
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache");
  },
}));

// --- Auth Routes ---
app.use("/api", createAuthRouter(authSystem));
app.use("/api", createLegacyAdminUserRoute(authSystem));
app.get("/api/admin/help", (req, res) => {
  const host = req.get("host") ?? `localhost:${config.port}`;
  const baseUrl = `${req.protocol}://${host}`;
  res.json(getAdminApiCatalog(baseUrl));
});
app.use("/api/admin", adminAuthMiddleware(authSystem), createAdminRouter(authSystem, usageRecorder, sessionManager, isolator));
app.use("/api/platform/admin", createPlatformAdminRouter(authSystem, usageRecorder, isolator, sessionManager, botRepository));
app.use("/api/bot", createBotRouter(authSystem, botRepository, isolator, sessionManager));
app.use("/api/public/bots", createPublicBotRouter(botRepository, sessionManager));
app.use("/api/groups", createSavedGroupRouter(authSystem, botRepository, isolator));

// --- Workspace Init (lightweight, no session creation) ---
app.post("/api/workspace/init", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const sessionId = req.userSession.sessionId as string;
    const ws = await isolator.ensureUserWorkspace(userId);
    // Credential sync touches live sessions only — must not block first paint.
    void sessionManager.syncUserAgentCredentials(userId, ws).catch((err) => {
      log.warn(`workspace credential sync failed: ${(err as Error).message}`, { userId });
    });
    log.info(`workspace init: ${userId}`);

    const payload: Record<string, unknown> = { workspacePath: ws };

    if (authSystem.isAdmin(userId)) {
      const host = req.get("host") ?? `localhost:${config.port}`;
      const baseUrl = `${req.protocol}://${host}`;
      const platformAdminBase = `${baseUrl}/api/platform/admin`;
      const today = new Date().toISOString().slice(0, 10);
      const platformAdmin = {
        sessionId,
        platformAdminBase,
        credentialUrl: `${platformAdminBase}/credential`,
        usersUrl: `${platformAdminBase}/users`,
        usageAllUrl: `${platformAdminBase}/usage`,
        usageUserUrl: `${platformAdminBase}/usage/{userIdOrUsername}`,
        usageUserDailyUrl: `${platformAdminBase}/usage/{userIdOrUsername}/daily`,
        modelsUrl: `${platformAdminBase}/models`,
        userModelFilterUrl: `${platformAdminBase}/users/{userIdOrUsername}/model-filter`,
        syncCredentialsUrl: `${platformAdminBase}/users/{userIdOrUsername}/sync-credentials`,
        botsUrl: `${platformAdminBase}/bots`,
        contextUrl: `${platformAdminBase}/context`,
        authHeader: `Authorization: Bearer ${sessionId}`,
        exampleAliceUsageToday: `${platformAdminBase}/usage/alice?from=${today}&to=${today}`,
      };
      payload.platformAdmin = platformAdmin;

      const contextPath = path.join(ws, ".pi", "platform-admin.json");
      await fs.mkdir(path.dirname(contextPath), { recursive: true });
      await fs.writeFile(contextPath, JSON.stringify(platformAdmin, null, 2), "utf-8");
    }

    res.json(payload);
  } catch (err) {
    log.error(`workspace init failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Session: Create new ---
app.post("/api/sessions/create", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const ws = isolator.getUserWorkspace(userId);
    const userPiSession = await sessionManager.createSession(userId, ws, (uid, event) => {});
    invalidateSessionsCache(userId);
    res.json({ sessionId: userPiSession.sessionId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Session: Activate / Continue existing ---
app.post("/api/sessions/:id/activate", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const piSessionId = req.params.id;
    const ws = isolator.getUserWorkspace(userId);
    const activated = await sessionManager.createSession(userId, ws, (uid, event) => {}, piSessionId);
    invalidateSessionsCache(userId);
    res.json({ sessionId: activated.sessionId });
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith("Session not found:")) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

// --- Session: Delete ---
app.delete("/api/sessions/:id", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const piSessionId = req.params.id;
    const ws = isolator.getUserWorkspace(userId);
    const sessionsDir = path.join(ws, ".pi", "sessions");
    const sessionFile = await findSessionFilePath(sessionsDir, piSessionId);
    if (sessionFile) {
      await fs.unlink(sessionFile);
    }
    // Also kill running session if active
    sessionManager.removeSession(piSessionId);
    invalidateSessionsCache(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function sessionStatusPayload(sessionManager: PISessionManager, sid: string) {
  return {
    footer: sessionManager.getFooterSnapshot(sid),
    widgets: sessionManager.getWidgetSnapshot(sid),
    plugins: sessionManager.getExtensionStatusSnapshot(sid),
    workingMessage: sessionManager.getWorkingMessage(sid),
    agentRunning: sessionManager.isAgentRunning(sid),
  };
}

// --- Session status bar (footer + widgets + plugin statuses) ---
app.get("/api/sessions/:id/status", authMiddleware(authSystem), (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const piSessionId = req.params.id;
    const session = sessionManager.getSession(piSessionId);
    if (!session || session.userId !== userId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(sessionStatusPayload(sessionManager, session.sessionId));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** @deprecated Prefer `/api/sessions/:id/status` — resolves the user's in-memory session. */
app.get("/api/session/status", authMiddleware(authSystem), (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const session = sessionManager.getSessionForUser(userId);
    if (!session) {
      res.status(400).json({ error: "No active session" });
      return;
    }
    res.json(sessionStatusPayload(sessionManager, session.sessionId));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Models ---
app.get("/api/models", authMiddleware(authSystem), (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const session = sessionManager.getSessionForUser(userId);
    if (!session) {
      res.status(400).json({ error: "No active session" });
      return;
    }
    const models = sessionManager.getAvailableModels(session.sessionId);
    const current = session.session.model;
    const availableLevels = session.session.getAvailableThinkingLevels();
    res.json({
      models,
      currentModel: current ? `${current.provider}/${current.id}` : undefined,
      availableThinkingLevels: availableLevels,
      currentThinkingLevel: session.session.thinkingLevel,
      steeringMode: session.session.steeringMode,
      followUpMode: session.session.followUpMode,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Slash Commands ---
app.get("/api/slash/commands", authMiddleware(authSystem), (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const session = sessionManager.getSessionForUser(userId);
    if (!session) {
      res.status(400).json({ error: "No active session" });
      return;
    }

    const prompts = session.session.resourceLoader.getPrompts().prompts.map((p) => ({
      id: p.name,
      label: p.name,
      description: p.description || "Prompt template",
      kind: "prompt",
      source: p.sourceInfo?.source || "prompt",
    }));

    const skills = session.session.resourceLoader.getSkills().skills.map((s) => ({
      id: `skill:${s.name}`,
      label: `skill:${s.name}`,
      description: s.description || "Skill",
      kind: "skill",
      source: s.sourceInfo?.source || "skill",
    }));

    const extCommands = (session.session.extensionRunner?.getRegisteredCommands() || []).map((c) => ({
      id: c.invocationName,
      label: c.invocationName,
      description: c.description || "Extension command",
      kind: "extension",
      source: c.sourceInfo?.source || "extension",
    }));

    res.json({
      system: [
        { id: "model", label: "model", description: "Pick a model", kind: "panel" },
        { id: "settings", label: "settings", description: "Adjust thinking level and preferences", kind: "panel" },
        { id: "new", label: "new", description: "Start a new session", kind: "instant" },
        { id: "resume", label: "resume", description: "Open session history", kind: "instant" },
        { id: "files", label: "files", description: "Browse workspace files", kind: "instant" },
        { id: "user", label: "user", description: "Account and preferences", kind: "instant" },
        { id: "fork", label: "fork", description: "Fork from conversation tree", kind: "instant" },
        { id: "tree", label: "tree", description: "Open conversation tree", kind: "instant" },
        { id: "compact", label: "compact", description: "Compact conversation history", kind: "instant" },
        { id: "name", label: "name", description: "Rename the session", kind: "args" },
        { id: "session", label: "session", description: "Session information", kind: "panel" },
        { id: "copy", label: "copy", description: "Copy the last message", kind: "instant" },
      ],
      dynamic: [...prompts, ...skills, ...extCommands],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Session Tree ---
app.get("/api/sessions/:id/tree", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const session = sessionManager.getSession(req.params.id) ?? sessionManager.getSessionForUser(userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const tree = sessionManager.getSessionTree(session.sessionId);
    res.json({ tree, currentEntryId: session.session.sessionManager.getLeafId() ?? undefined });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Token Usage ---
app.get("/api/token/usage", authMiddleware(authSystem), (req: any, res) => {
  const userId = req.userSession.userId;
  const usage = tokenTracker.getUsage(userId);
  const user = authSystem.getUser(userId);
  const today = new Date().toISOString().slice(0, 10);
  const daily = usageRecorder.getDaily(userId, today);
  const budget = user ? budgetSnapshot(user) : { budgetUsd: null, budgetUsedUsd: 0, budgetRemainingUsd: null, budgetUnlimited: true };
  res.json({
    totalInput: usage.totalInput,
    totalOutput: usage.totalOutput,
    totalTokens: usage.totalInput + usage.totalOutput,
    used: user?.tokensUsed ?? 0,
    ...budget,
    costTodayUsd: daily?.totals.costUsd ?? 0,
    costTodayBySource: daily
      ? {
          chat: daily.bySource.chat.costUsd,
          subagent: daily.bySource.subagent.costUsd,
        }
      : { chat: 0, subagent: 0 },
  });
});

// --- Sessions list cache (30s TTL per user) ---
interface SessionsCacheEntry {
  sessions: { id: string; title: string; timestamp: string; messageCount: number }[];
  timestamp: number;
}
const sessionsCache = new Map<string, SessionsCacheEntry>();
const SESSIONS_CACHE_TTL_MS = 30_000;

function invalidateSessionsCache(userId: string): void {
  sessionsCache.delete(userId);
}

app.get("/api/sessions", authMiddleware(authSystem), async (req: any, res) => {
  try {
    const userId = req.userSession.userId;
    const cached = sessionsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < SESSIONS_CACHE_TTL_MS) {
      res.json(cached.sessions);
      return;
    }

    const ws = isolator.getUserWorkspace(userId);
    const sessionsDir = path.join(ws, ".pi", "sessions");

    let files: string[] = [];
    try { files = await fs.readdir(sessionsDir); } catch { files = []; }
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).sort().reverse();

    const sessions: { id: string; title: string; timestamp: string; messageCount: number }[] = [];
    for (const file of jsonlFiles) {
      try {
        const content = await fs.readFile(path.join(sessionsDir, file), "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length === 0) continue;
        const header = JSON.parse(lines[0]);
        let title = "";
        for (let i = 1; i < lines.length; i++) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.type === "message" && entry.message?.role === "user") {
              title = titleFromUserMessage(entry.message);
              break;
            }
          } catch { continue; }
        }
        sessions.push({
          id: header.id,
          title: title ? title.slice(0, 60) : "(empty)",
          timestamp: header.timestamp,
          messageCount: lines.length - 1,
        });
      } catch { continue; }
    }
    sessionsCache.set(userId, { sessions, timestamp: Date.now() });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- File Routes ---
app.use("/api", createFilesRouter(authSystem, isolator));

// --- Browser-backed render API (HYW card-ui: 560px × zoom 1.5) ---
// 认证用户渲染端点
app.post("/api/render", authMiddleware(authSystem), createMessageRenderHandler(messageRenderer, false));
app.post(
  "/api/render/b64",
  (req: any, res, next) => {
    // The colocated Entari plugin calls this endpoint through 127.0.0.1 and
    // cannot reuse a browser login session. Trust only the actual TCP peer —
    // never X-Forwarded-For — so remote callers still require authentication.
    const peer = req.socket?.remoteAddress;
    const host = String(req.headers.host ?? "").toLowerCase();
    const isDirectLoopback =
      (peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1") &&
      (host.startsWith("127.0.0.1:") || host.startsWith("localhost:")) &&
      !req.headers["cf-connecting-ip"] &&
      !req.headers["x-forwarded-for"];
    if (isDirectLoopback) {
      next();
      return;
    }
    authMiddleware(authSystem)(req, res, next);
  },
  createMessageRenderHandler(messageRenderer, true),
);
// 公开渲染端点（访客只读 — 速率限制更严格）
app.post("/api/public/render", apiRateLimiter, createMessageRenderHandler(messageRenderer, false));
app.post("/api/public/render/b64", apiRateLimiter, createMessageRenderHandler(messageRenderer, true));

// Public bot upload downloads (tokenized ids; no workspace path exposure).
app.get("/api/public/uploads/:id/:filename", apiRateLimiter, async (req, res) => {
  try {
    const loaded = await loadBotUpload(String(req.params.id));
    if (!loaded) {
      res.status(404).json({ error: "Upload not found" });
      return;
    }
    res.setHeader("Content-Type", loaded.meta.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(loaded.meta.filename)}`,
    );
    res.send(loaded.buffer);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// --- Health ---
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: Date.now(), adminHelp: "/api/admin/help", adminCli: "npm run admin -- help" })
);

const clientDistDir = attachClientStatic(app);
if (clientDistDir) {
  log.info(`serving web UI from ${clientDistDir}`);
}

app.use(errorHandler);

// --- HTTP + WebSocket Server ---
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// WebSocket 升级拦截：Origin + sessionId（view=1 时免验证）
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host}`);

  if (!isWebSocketOriginAllowed(request)) {
    log.warn("ws upgrade rejected: origin not allowed", {
      origin: request.headers.origin ?? "(none)",
      path: url.pathname,
    });
    socket.destroy();
    return;
  }

  const sessionId = url.searchParams.get("sessionId");
  const piSessionId = url.searchParams.get("piSessionId");
  const isViewOnly = url.searchParams.get("view") === "1";

  // 访客只读模式：无需 sessionId，但不能写入
  if (isViewOnly) {
    if (!piSessionId) {
      log.warn("ws upgrade rejected: view mode requires piSessionId", { path: url.pathname });
      socket.destroy();
      return;
    }
    (request as any).userId = "__guest__";
    (request as any).piSessionId = piSessionId;
    (request as any).isViewOnly = true;

    if (url.pathname === "/ws/chat") {
      log.info("ws view-only upgrade accepted", { piSessionId });
      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).userId = "__guest__";
        (ws as any).isViewOnly = true;
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
    return;
  }

  if (!sessionId) {
    log.warn("ws upgrade rejected: missing sessionId", { path: url.pathname });
    socket.destroy();
    return;
  }
  const session = authSystem.validateSession(sessionId);
  if (!session) {
    log.warn("ws upgrade rejected: invalid session", { path: url.pathname });
    socket.destroy();
    return;
  }

  (request as any).userId = session.userId;
  (request as any).piSessionId = piSessionId;
  (request as any).isViewOnly = false;

  if (url.pathname === "/ws/chat") {
    log.info("ws upgrade accepted", { userId: session.userId, piSessionId: piSessionId ?? null });
    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as any).userId = session.userId;
      (ws as any).isViewOnly = false;
      wss.emit("connection", ws, request);
    });
  } else {
    log.warn("ws upgrade rejected: unknown path", { path: url.pathname });
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const userId = (ws as any).userId;
  const piSessionId = (req as any).piSessionId;
  const isViewOnly = (ws as any).isViewOnly === true;
  if (url.pathname === "/ws/chat") {
    handleChatWs(ws, sessionManager, tokenTracker, usageRecorder, authSystem, isolator, userId, piSessionId, isViewOnly, botRepository);
  }
});

// --- 启动 ---
server.listen(config.port, "0.0.0.0", async () => {
  await loadPlatformSystemMd();
  await loadPlatformBotSystemMd();
  // 确保至少有一个 admin 用户
  const users = authSystem.getAllUsers();
  if (!authSystem.hasAdminUser()) {
    const bootstrapKey = generateApiKey();
    const { plainKey } = await authSystem.createUser(bootstrapKey, "Admin", {
      role: "admin",
      username: "admin",
      budgetUsd: null,
    });
    logger.info("first admin user created (API key printed once to stdout, not stored on disk)");
    printFirstAdminKeyNotice(plainKey);
  }
  logger.info(`HY-Webagent listening on http://localhost:${config.port}`);
  console.log(`HY-Webagent → http://localhost:${config.port}`);
  if (clientDistDir) {
    console.log(`Web UI         → http://localhost:${config.port}/`);
  } else if (process.env.NODE_ENV !== "production") {
    console.log(`Web UI (dev)   → http://localhost:5173 (run npm run dev:client)`);
  }
  console.log(`Health check   → http://localhost:${config.port}/health`);
});
