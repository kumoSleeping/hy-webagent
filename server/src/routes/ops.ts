import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthSystem } from "../auth.js";
import { authMiddleware } from "./auth.js";
import { Updater } from "../ops/updater.js";
import { createLogger } from "../logger.js";

const log = createLogger("ops-routes");

function requireAdminRole(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).userSession;
  if (!session || session.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}

/**
 * Operational control surface: `/api/ops/*`.
 *
 * Admin-only in full. Even the read-only endpoints are gated, because commit
 * hashes and update history are deployment intelligence — `/health` already
 * covers what an unauthenticated caller (or a load balancer) legitimately needs.
 */
export function createOpsRouter(authSystem: AuthSystem, updater: Updater): Router {
  const router = Router();
  router.use(authMiddleware(authSystem), requireAdminRole);

  /** Current build + last known update outcome. */
  router.get("/update/status", async (_req: Request, res: Response) => {
    try {
      const [status, currentCommit, inFlight] = await Promise.all([
        updater.readStatus(),
        updater.currentCommit(),
        updater.isInFlight(),
      ]);
      res.json({ currentCommit, inFlight, status });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Is origin ahead? Read-only — does not fetch or mutate the working tree. */
  router.get("/update/check", async (_req: Request, res: Response) => {
    try {
      res.json(await updater.checkForUpdate());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Start an update. Returns 202 immediately — the run outlives this process,
   * so there is no meaningful completion to await here. Poll /update/status.
   *
   * `dryRun` stops after establishing whether an update exists, which is the
   * safe way to exercise the whole path (including auth and spawning) without
   * risking a restart.
   */
  router.post("/update/apply", async (req: Request, res: Response) => {
    try {
      const dryRun = req.body?.dryRun === true;
      const result = await updater.triggerUpdate({ dryRun });
      if (!result.started) {
        res.status(409).json({ error: result.reason });
        return;
      }
      const actor = (req as any).userSession?.username ?? "unknown";
      log.warn(`self-update triggered by ${actor} (dryRun=${dryRun}, pid=${result.pid})`);
      res.status(202).json({
        started: true,
        dryRun,
        pid: result.pid,
        note: "Update runs detached; the service will restart. Poll /api/ops/update/status.",
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
