import type { Request, Response, NextFunction } from "express";
import type { AuthSystem } from "../auth.js";
import { config } from "../config.js";
import { matchesMasterAdminKey } from "../admin-key.js";

export interface AdminContext {
  kind: "user" | "master";
  userId?: string;
  displayName?: string;
  username?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    adminContext?: AdminContext;
  }
}

export function adminAuthMiddleware(authSystem: AuthSystem) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }

    const adminUser = await authSystem.verifyAdminApiKey(bearer);
    if (adminUser) {
      req.adminContext = {
        kind: "user",
        userId: adminUser.userId,
        displayName: adminUser.displayName,
        username: adminUser.username,
      };
      next();
      return;
    }

    const session = authSystem.validateSession(bearer);
    if (session?.role === "admin") {
      req.adminContext = {
        kind: "user",
        userId: session.userId,
        displayName: session.displayName,
        username: session.username,
      };
      next();
      return;
    }

    if (matchesMasterAdminKey(bearer, config.adminKey)) {
      req.adminContext = { kind: "master" };
      next();
      return;
    }

    res.status(403).json({ error: "Admin authorization required" });
  };
}
