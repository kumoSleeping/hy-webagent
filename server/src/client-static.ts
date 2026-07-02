import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import express from "express";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Resolve built client `index.html` for production single-process mode. */
export function resolveClientDistDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "..", "client", "dist"),
    path.join(MODULE_DIR, "../public"),
    path.join(MODULE_DIR, "../../client/dist"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

/** Serve Vite build + SPA fallback when a client dist folder exists. */
export function attachClientStatic(app: Express): string | null {
  const distDir = resolveClientDistDir();
  if (!distDir) return null;

  app.use(express.static(distDir, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });

  return distDir;
}
