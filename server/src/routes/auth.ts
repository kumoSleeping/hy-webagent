import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthSystem } from "../auth.js";
import { budgetSnapshot } from "../auth.js";

export function createAuthRouter(authSystem: AuthSystem): Router {
  const router = Router();

  function profilePayload(userId: string) {
    const user = authSystem.getUser(userId);
    if (!user) return null;
    return {
      userId: user.userId,
      displayName: user.displayName,
      username: user.username ?? user.displayName,
      role: user.role ?? "user",
      tokensUsed: user.tokensUsed,
      ...budgetSnapshot(user),
    };
  }

  router.get("/auth/me", authMiddleware(authSystem), (req: Request, res: Response) => {
    const userId = (req as any).userSession.userId as string;
    const profile = profilePayload(userId);
    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(profile);
  });

  router.post("/auth/login", async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string") {
        res.status(400).json({ error: "apiKey is required" });
        return;
      }
      const session = await authSystem.login(apiKey);
      if (session.role === "bot") {
        authSystem.logout(session.sessionId);
        res.status(403).json({ error: "Bot accounts must use /api/bot/login" });
        return;
      }
      const user = authSystem.getUser(session.userId);
      if (!user) {
        res.status(500).json({ error: "User record missing after login" });
        return;
      }
      res.json({
        sessionId: session.sessionId,
        ...profilePayload(user.userId),
      });
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
    }
  });

  router.post("/auth/logout", (req: Request, res: Response) => {
    const { sessionId } = req.body;
    authSystem.logout(sessionId);
    res.json({ ok: true });
  });

  return router;
}

export function authMiddleware(authSystem: AuthSystem) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    const sessionId = header.replace(/^Bearer\s+/i, "");
    if (!sessionId) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }
    const session = authSystem.validateSession(sessionId);
    if (!session) {
      res.status(401).json({ error: "Session expired or invalid" });
      return;
    }
    (req as any).userSession = session;
    next();
  };
}
