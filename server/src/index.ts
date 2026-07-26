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
import { BrowserMessageRenderer } from "./render/browser-message-renderer.js";
import { createMessageRenderHandler } from "./routes/message-render.js";
import { createPlatformAdminRouter } from "./routes/platform-admin.js";
import path from "node:path";
import { findSessionFilePath, isValidSessionId } from "./pi/session-files.js";
import fs from "node:fs/promises";
import { loadPlatformSystemMd, loadPlatformBotSystemMd } from "./pi/platform-system.js";
import logger, { createLogger } from "./logger.js";
import { getAdminApiCatalog } from "./admin/catalog.js";
import { titleFromUserMessage } from "./attachment-display.js";
import { printFirstAdminKeyNotice } from "./admin-key.js";
import { resolveModelPolicy } from "./model-policy.js";
import helmet from "helmet";
import { attachRequestId, errorHandler } from "./middleware/error-handler.js";
import { apiRateLimiter, loginRateLimiter } from "./middleware/rate-limit.js";
import { isWebSocketOriginAllowed, isOriginAllowed } from "./ws-origin.js";
import { attachClientStatic } from "./client-static.js";
import { BotRepository } from "./bot/repository.js";
import { createBotRouter, createPublicBotRouter, createSavedGroupRouter } from "./routes/bot.js";
import { loadBotUpload } from "./bot/uploads.js";
import { Updater } from "./ops/updater.js";
import { createOpsRouter } from "./routes/ops.js";
import { SessionShareRepository } from "./db/session-share-repository.js";
import { createSessionShareRouter } from "./routes/session-share.js";
import {
  startEventLoopMonitor,
  stopEventLoopMonitor,
  livenessPayload,
  readiness,
  isAlive,
  type HealthDeps,
} from "./ops/health.js";
import { installLifecycle } from "./ops/lifecycle.js";
import { notifyReady, notifyStopping, notifyStatus, startWatchdog, stopWatchdog } from "./ops/sd-notify.js";

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
// Bot uploads carry base64 payloads up to 20MB binary (~26.7MB encoded).
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/bot/upload") {
    express.json({ limit: "30mb" })(req, res, next);
    return;
  }
  express.json({ limit: "1mb" })(req, res, next);
});
app.use(compression());
app.use("/api", (req, res, next) => {
  // /auth/login verifies a bcrypt hash, so it is a CPU amplification target as
  // much as a credential-guessing one and gets the tighter limiter rather than
  // the exemption it used to have. /auth/me and /auth/logout stay exempt: the
  // UI polls them on every route change and they do no expensive work.
  if (req.path === "/auth/login") {
    loginRateLimiter(req, res, next);
    return;
  }
  if (req.path === "/auth/me" || req.path === "/auth/logout") {
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
const sessionShares = new SessionShareRepository(config.databasePath);
const messageRenderer = new BrowserMessageRenderer(`http://127.0.0.1:${config.port}`);

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
    if (!isValidSessionId(piSessionId)) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }
    // removeSession() below is a bare map lookup with no owner filter, so the
    // caller's claim to this session has to be established here — otherwise any
    // authenticated user could tear down another user's live agent mid-turn.
    const live = sessionManager.getSession(piSessionId);
    if (live && live.userId !== userId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const ws = isolator.getUserWorkspace(userId);
    const sessionsDir = path.join(ws, ".pi", "sessions");
    const sessionFile = await findSessionFilePath(sessionsDir, piSessionId);
    if (sessionFile) {
      await fs.unlink(sessionFile);
    }
    // Also kill running session if active
    await sessionManager.removeSession(piSessionId);
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
    // getSession() is an unfiltered global map lookup: without the owner check
    // any authenticated user could pass someone else's piSessionId and read
    // their conversation tree, which carries per-entry message previews.
    const requested = sessionManager.getSession(req.params.id);
    if (requested && requested.userId !== userId) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const session = requested ?? sessionManager.getSessionForUser(userId);
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
          title: title ? title.slice(0, 60) : "New Session",
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

// --- Owner-controlled read-only share links ---
app.use("/api", createSessionShareRouter(authSystem, sessionShares, sessionManager, isolator));

// --- Browser-backed render API (same React/CSS tree as the web conversation) ---
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

/**
 * A pi session is guest-viewable only if it was published through a bot channel
 * whose account is still enabled. Guest connections carry no credentials, so
 * membership in `bot_sessions` is the entire authorization decision — never fall
 * back to searching workspaces for an id the caller merely asserts.
 */
function isPubliclyViewableSession(piSessionId: string): boolean {
  if (!isValidSessionId(piSessionId)) return false;
  try {
    const record = botRepository.findSession(piSessionId);
    if (!record) return false;
    return botRepository.findAccountByUserId(record.botUserId)?.enabled === true;
  } catch (err) {
    log.warn(`public session lookup failed: ${(err as Error).message}`, { piSessionId });
    return false;
  }
}

/**
 * Authorize an unauthenticated guest view.
 *
 * Two — and only two — grounds count, because a guest presents no credentials:
 *   1. the session was published through an enabled bot channel, or
 *   2. the caller holds an unrevoked, unexpired share token issued by the owner
 *      *for this exact session*.
 *
 * Returns the owning userId when known, so history can be read from that one
 * workspace instead of scanning every workspace on disk for a matching id.
 */
function authorizeGuestView(
  piSessionId: string,
  shareToken: string | null,
): { allowed: false } | { allowed: true; ownerUserId?: string } {
  if (!isValidSessionId(piSessionId)) return { allowed: false };

  if (isPubliclyViewableSession(piSessionId)) {
    const record = botRepository.findSession(piSessionId);
    return { allowed: true, ownerUserId: record?.botUserId };
  }

  if (shareToken) {
    try {
      const share = sessionShares.resolve(shareToken);
      // Bind the token to the session it was issued for: a valid token for one
      // session must not unlock another.
      if (share && share.piSessionId === piSessionId) {
        sessionShares.recordView(shareToken);
        return { allowed: true, ownerUserId: share.ownerUserId };
      }
    } catch (err) {
      log.warn(`share token lookup failed: ${(err as Error).message}`, { piSessionId });
    }
  }

  return { allowed: false };
}

// --- Ops: admin-only update control ---
const updater = new Updater({ healthUrl: `http://127.0.0.1:${config.port}/health` });
app.use("/api/ops", createOpsRouter(authSystem, updater));

// --- Health ---
// Split deliberately (see ops/health.ts): /health is liveness and drives the
// restart decision, /health/ready is readiness and drives traffic routing.
startEventLoopMonitor();
const healthDeps: HealthDeps = {
  db: () => botRepository.rawDb,
  sessionCount: () => sessionManager.activeSessionCount(),
  version: process.env.npm_package_version ?? "1.0.0",
  commit: process.env.GIT_COMMIT ?? "unknown",
};

app.get("/health", (_req, res) => {
  const payload = livenessPayload(healthDeps);
  res.status(payload.ok ? 200 : 503).json({
    ...payload,
    adminHelp: "/api/admin/help",
    adminCli: "npm run admin -- help",
  });
});

app.get("/health/ready", (_req, res) => {
  const report = readiness(healthDeps);
  // 503 rather than a restart: a dependency being down is not something
  // recycling this process repairs, and flapping would widen the outage.
  res.status(report.ok ? 200 : 503).json(report);
});

const clientDistDir = attachClientStatic(app);
if (clientDistDir) {
  log.info(`serving web UI from ${clientDistDir}`);
}

app.use(errorHandler);

// --- HTTP + WebSocket Server ---
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  // 32MB decoded image total expands to ~42.7MB as base64 JSON.
  maxPayload: 48 * 1024 * 1024,
});

// WebSocket 升级拦截：Origin + sessionId（view=1 时免验证）
server.on("upgrade", (request, socket, head) => {
  // An exception escaping an 'upgrade' listener is an uncaughtException, i.e. a
  // remotely triggerable, pre-auth process kill. `new URL()` below throws on a
  // malformed Host header (e.g. "Host: ["), so the whole handler is guarded.
  try {
    handleUpgrade(request, socket, head);
  } catch (err) {
    log.warn(`ws upgrade failed: ${(err as Error).message}`);
    try {
      socket.destroy();
    } catch {
      // Socket already gone.
    }
  }
});

function handleUpgrade(
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
): void {
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

  // 访客只读模式：仅限已发布的 bot 会话，不能写入
  if (isViewOnly) {
    if (!piSessionId) {
      log.warn("ws upgrade rejected: view mode requires piSessionId", { path: url.pathname });
      socket.destroy();
      return;
    }
    // 多会话直播:登录用户带 view=1 = 自己会话的只读小窗 socket
    // (不抢主 socket 的事件槽;写入仍被 writableTypes 拦截)。
    const ownerAuth = sessionId ? authSystem.validateSession(sessionId) : null;
    if (ownerAuth) {
      (request as any).userId = ownerAuth.userId;
      (request as any).piSessionId = piSessionId;
      (request as any).isViewOnly = true;
      if (url.pathname === "/ws/chat") {
        log.info("ws owner feed-view upgrade accepted", { userId: ownerAuth.userId, piSessionId });
        wss.handleUpgrade(request, socket, head, (ws) => {
          (ws as any).userId = ownerAuth.userId;
          (ws as any).isViewOnly = true;
          wss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
      return;
    }
    // Guest view is unauthenticated, so it must resolve only sessions that were
    // deliberately published — via a bot channel or an owner-issued share token.
    // Without this, any piSessionId — including a partial one — reached a
    // cross-workspace disk scan and streamed another user's full transcript,
    // tool calls included.
    const guestAuth = authorizeGuestView(piSessionId, url.searchParams.get("share"));
    if (!guestAuth.allowed) {
      log.warn("ws upgrade rejected: session is not publicly viewable", { piSessionId });
      socket.destroy();
      return;
    }
    (request as any).userId = "__guest__";
    (request as any).piSessionId = piSessionId;
    (request as any).isViewOnly = true;
    (request as any).guestOwnerUserId = guestAuth.ownerUserId;

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
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const userId = (ws as any).userId;
  const piSessionId = (req as any).piSessionId;
  const isViewOnly = (ws as any).isViewOnly === true;
  if (url.pathname === "/ws/chat") {
    handleChatWs(ws, sessionManager, tokenTracker, usageRecorder, authSystem, isolator, userId, piSessionId, isViewOnly, botRepository, (req as any).guestOwnerUserId);
  }
});

// --- Keep-alive: signals, fatal-error handling, graceful drain ---
// Single owner of SIGTERM/SIGINT for the whole process. Ordering below matters:
// stop the watchdog before draining (a slow drain must not be read as a hang),
// persist usage before closing the DB that stores it.
installLifecycle({
  server,
  wss,
  graceMs: 15_000,
  onShutdownStart: () => {
    stopWatchdog();
    stopEventLoopMonitor();
    notifyStopping();
  },
  tasks: [
    { name: "usage-recorder-flush", run: () => usageRecorder.flush() },
    { name: "pi-sessions-dispose", run: () => sessionManager.disposeAll() },
    { name: "bot-repository-close", run: () => botRepository.close() },
    { name: "session-shares-close", run: () => sessionShares.close() },
  ],
});

// --- 启动 ---
server.listen(config.port, "0.0.0.0", async () => {
  try {
    await loadPlatformSystemMd();
    await loadPlatformBotSystemMd();
    // 确保至少有一个 admin 用户
    if (!authSystem.hasAdminUser()) {
      const bootstrapKey = generateApiKey();
      const { plainKey } = await authSystem.createUser(bootstrapKey, "Admin", {
        role: "admin",
        username: "admin",
        budgetUsd: null,
      });
      logger.info("first admin user created (API key printed once to stdout)");
      printFirstAdminKeyNotice(plainKey);
    }
  } catch (err) {
    // This callback is async: an unhandled rejection here would crash-loop the
    // unit under systemd with no usable diagnostic. Fail loudly and explicitly.
    logger.error(`startup failed: ${(err as Error).stack ?? String(err)}`);
    process.exit(1);
  }

  // Tell systemd we are serving, then start the liveness ping. Withholding the
  // ping when isAlive() goes false is what lets systemd recover a process that
  // is wedged but still holding the port — the case Restart=always cannot see.
  notifyReady(`listening on ${config.port}`);
  startWatchdog(isAlive);
  notifyStatus(`ready on port ${config.port}`);

  logger.info(`HY-Webagent listening on http://localhost:${config.port}`);
  console.log(`HY-Webagent → http://localhost:${config.port}`);
  if (clientDistDir) {
    console.log(`Web UI         → http://localhost:${config.port}/`);
  } else if (process.env.NODE_ENV !== "production") {
    console.log(`Web UI (dev)   → http://localhost:5173 (run npm run dev:client)`);
  }
  console.log(`Health check   → http://localhost:${config.port}/health`);
});
