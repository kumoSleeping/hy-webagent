import { Router, type Request, type Response } from "express";
import type { AuthSystem } from "../auth.js";
import { authMiddleware } from "./auth.js";
import type { SessionShareRepository } from "../db/session-share-repository.js";
import type { PISessionManager } from "../pi/session-manager.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";
import { findSessionFilePath, isValidSessionId } from "../pi/session-files.js";
import { createLogger } from "../logger.js";
import path from "node:path";

const log = createLogger("session-share");

/** Ceiling on link lifetime; an unbounded public link is a standing liability. */
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Owner-controlled read-only sharing for ordinary (non-bot) sessions.
 *
 * Guest view is unauthenticated, so it can only safely resolve sessions that
 * were *deliberately* published. Bot channels are one such signal; this router
 * provides the other, for sessions a user wants to share directly.
 */
export function createSessionShareRouter(
  authSystem: AuthSystem,
  shares: SessionShareRepository,
  sessionManager: PISessionManager,
  isolator: WorkspaceIsolator,
): Router {
  const router = Router();
  // 只鉴权本路由自己的路径。router 级 use(authMiddleware) 曾把整个裸 /api
  // 前缀上、挂载点之后的一切请求(含 /api/public/render*、/api/public/uploads)
  // 都 401 短路 —— Express 的 app.use("/api", router) 会让所有 /api/* 穿过
  // 这里的中间件,即使本 router 根本没有匹配路由。
  router.use("/sessions/:id/share", authMiddleware(authSystem));

  /**
   * Confirm the caller owns this session.
   *
   * Checks the live map first, then falls back to the caller's own sessions
   * directory — a session that has been evicted from memory is still theirs to
   * share. The disk lookup is inherently owner-scoped because it only ever
   * looks inside that user's workspace.
   */
  async function assertOwnership(userId: string, piSessionId: string): Promise<boolean> {
    const live = sessionManager.getSession(piSessionId);
    if (live) return live.userId === userId;
    try {
      const workspace = isolator.getUserWorkspace(userId);
      const sessionsDir = path.join(workspace, ".pi", "sessions");
      return (await findSessionFilePath(sessionsDir, piSessionId)) !== null;
    } catch {
      return false;
    }
  }

  /** Create a share link. The token is returned once and never again. */
  router.post("/sessions/:id/share", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId as string;
      const piSessionId = String(req.params.id);
      if (!isValidSessionId(piSessionId)) {
        res.status(400).json({ error: "Invalid session id" });
        return;
      }
      if (!(await assertOwnership(userId, piSessionId))) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const requestedTtl = Number(req.body?.ttlMs);
      const ttlMs = Number.isFinite(requestedTtl) && requestedTtl > 0
        ? Math.min(requestedTtl, MAX_TTL_MS)
        : DEFAULT_TTL_MS;

      // One live link per session: issuing a new one invalidates the old, so a
      // link that has spread further than intended can be replaced, not merely
      // supplemented.
      shares.revokeAllForSession(piSessionId, userId);
      const { token, share } = shares.create({ piSessionId, ownerUserId: userId, ttlMs });

      log.info("session share created", { userId, piSessionId, expiresAt: share.expiresAt });
      res.status(201).json({
        token,
        expiresAt: share.expiresAt,
        // Relative on purpose — the caller knows its own origin, and the server
        // should not bake a possibly-wrong public hostname into the link.
        path: `/preview/${piSessionId}?share=${encodeURIComponent(token)}`,
        note: "Copy this link now — the token is not retrievable later.",
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Whether a live share exists, without disclosing the token itself. */
  router.get("/sessions/:id/share", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId as string;
      const piSessionId = String(req.params.id);
      if (!isValidSessionId(piSessionId)) {
        res.status(400).json({ error: "Invalid session id" });
        return;
      }
      if (!(await assertOwnership(userId, piSessionId))) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const active = shares
        .listForSession(piSessionId)
        .filter((share) => share.ownerUserId === userId);
      res.json({
        shared: active.length > 0,
        shares: active.map((share) => ({
          createdAt: share.createdAt,
          expiresAt: share.expiresAt,
          lastViewedAt: share.lastViewedAt,
          viewCount: share.viewCount,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Revoke every link for this session. Takes effect on the next connection. */
  router.delete("/sessions/:id/share", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId as string;
      const piSessionId = String(req.params.id);
      if (!isValidSessionId(piSessionId)) {
        res.status(400).json({ error: "Invalid session id" });
        return;
      }
      if (!(await assertOwnership(userId, piSessionId))) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      const revoked = shares.revokeAllForSession(piSessionId, userId);
      log.info("session shares revoked", { userId, piSessionId, revoked });
      res.json({ ok: true, revoked });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
