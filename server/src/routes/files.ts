import { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AuthSystem } from "../auth.js";
import type { WorkspaceIsolator } from "../pi/isolation.js";
import type { FileEntry } from "../types.js";
import { authMiddleware } from "./auth.js";
import { safeRemoteFetch } from "../ssrf.js";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
};

export function createFilesRouter(authSystem: AuthSystem, isolator: WorkspaceIsolator): Router {
  const router = Router();
  const auth = authMiddleware(authSystem);

  // GET /api/files/list?path=
  router.get("/files/list", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const dirPath = (req.query.path as string) || "";
      const resolved = isolator.validatePath(userId, dirPath);
      isolator.checkSensitive(resolved);

      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const result: FileEntry[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(resolved, entry.name);
        const relativePath = path.relative(isolator.getVisibleRoot(userId), fullPath).replace(/\\/g, "/");

        const fileEntry: FileEntry = {
          name: entry.name,
          path: relativePath || entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        };

        if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            fileEntry.size = stat.size;
            fileEntry.modifiedAt = stat.mtimeMs;
          } catch {}
        }
        result.push(fileEntry);
      }

      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/read?path=
  router.get("/files/read", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const filePath = (req.query.path as string) || "";
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      const content = await fs.readFile(resolved, "utf-8");
      res.json({ path: filePath, content });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/media?path=  — returns binary file as base64 (for preview)
  router.get("/files/media", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const filePath = (req.query.path as string) || "";
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        res.status(400).json({ error: "Not a file" });
        return;
      }
      if (stat.size > 50 * 1024 * 1024) {
        res.status(400).json({ error: "File too large for preview" });
        return;
      }

      const buffer = await fs.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";
      const data = buffer.toString("base64");
      res.json({ path: filePath, mimeType, data });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/files/download?path=  — attachment download from projects/
  router.get("/files/download", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const filePath = (req.query.path as string) || "";
      if (!filePath) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        res.status(400).json({ error: "Not a file" });
        return;
      }

      res.download(resolved, path.basename(resolved));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/write  { path, content }
  router.post("/files/write", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { filePath, content } = req.body;
      if (!filePath || content === undefined) {
        res.status(400).json({ error: "path and content required" });
        return;
      }
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, String(content), "utf-8");
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/files/delete  body: { path }
  router.delete("/files/delete", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      await fs.rm(resolved, { recursive: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/mkdir  body: { path }
  router.post("/files/mkdir", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const resolved = isolator.validatePath(userId, filePath);
      isolator.checkSensitive(resolved);

      await fs.mkdir(resolved, { recursive: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/files/rename  body: { oldPath, newPath }
  router.post("/files/rename", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) {
        res.status(400).json({ error: "oldPath and newPath required" });
        return;
      }
      const resolvedOld = isolator.validatePath(userId, oldPath);
      const resolvedNew = isolator.validatePath(userId, newPath);
      isolator.checkSensitive(resolvedNew);

      await fs.mkdir(path.dirname(resolvedNew), { recursive: true });
      await fs.rename(resolvedOld, resolvedNew);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/remote/fetch  body: { url, filename? }
  router.post("/remote/fetch", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { url, filename } = req.body;
      if (!url) { res.status(400).json({ error: "url required" }); return; }

      const response = await safeRemoteFetch(url, { timeoutMs: 30_000 });
      if (!response.ok) {
        res.status(502).json({ error: `Remote returned ${response.status}` });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || 0);
      const isText = contentType.includes("text") || contentType.includes("json") || contentType.includes("javascript") || contentType.includes("xml") || contentType.includes("yaml");

      let content = "";
      if (isText && contentLength < 500_000) {
        content = await response.text();
      }

      // Determine filename
      const urlPath = new URL(url).pathname;
      const name = filename || urlPath.split("/").pop() || "download";

      res.json({ name, contentType, contentLength, content, isText });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/remote/download  body: { url, filename?, targetPath? }
  router.post("/remote/download", auth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userSession.userId;
      const { url, filename, targetPath } = req.body;
      if (!url) { res.status(400).json({ error: "url required" }); return; }

      const response = await safeRemoteFetch(url, { timeoutMs: 60_000 });
      if (!response.ok) {
        res.status(502).json({ error: `Remote returned ${response.status}` });
        return;
      }

      const urlPath = new URL(url).pathname;
      const name = filename || urlPath.split("/").pop() || "download";
      const destPath = targetPath || "";
      const resolved = isolator.validatePath(userId, path.join(destPath, name));
      isolator.checkSensitive(resolved);

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, buffer);

      const stat = await fs.stat(resolved);
      res.json({ ok: true, path: path.relative(isolator.getVisibleRoot(userId), resolved), name, size: stat.size });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
