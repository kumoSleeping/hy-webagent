import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface BotUploadMeta {
  id: string;
  botUserId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
  storedPath: string;
}

export interface BotUploadCredential {
  uploadUrl: string;
  token: string;
  publicBasePath: string;
}

const TOKEN_FILE = "upload-token";
const META_FILE = "upload.json";
const USER_ID_FILE = "user-id";

function uploadsRoot(): string {
  return path.join(path.dirname(path.resolve(config.databasePath)), "bot-uploads");
}

function tokenIndexPath(): string {
  return path.join(path.dirname(path.resolve(config.databasePath)), "bot-upload-tokens.json");
}

function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_").slice(0, 180);
  return base || "file.bin";
}

function guessMime(filename: string, explicit?: string): string {
  if (explicit && /^[\w.+-]+\/[\w.+-]+$/.test(explicit)) return explicit;
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json",
    ".csv": "text/csv; charset=utf-8",
    ".zip": "application/zip",
    ".html": "text/html; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}

async function readTokenIndex(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await fs.readFile(tokenIndexPath(), "utf-8"));
    return raw && typeof raw === "object" ? raw as Record<string, string> : {};
  } catch {
    return {};
  }
}

async function writeTokenIndex(index: Record<string, string>): Promise<void> {
  const dir = path.dirname(tokenIndexPath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tokenIndexPath(), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
}

export async function ensureBotUploadCredential(
  botUserId: string,
  workspacePath: string,
  port = config.port,
): Promise<BotUploadCredential> {
  const piDir = path.join(workspacePath, ".pi");
  await fs.mkdir(piDir, { recursive: true });
  await fs.writeFile(path.join(piDir, USER_ID_FILE), `${botUserId}\n`, { mode: 0o600 });

  const tokenPath = path.join(piDir, TOKEN_FILE);
  let token: string;
  try {
    token = (await fs.readFile(tokenPath, "utf-8")).trim();
    if (!token || token.length < 16) throw new Error("empty");
  } catch {
    token = crypto.randomBytes(24).toString("hex");
    await fs.writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  }

  const index = await readTokenIndex();
  if (index[token] !== botUserId) {
    // Drop stale tokens for this bot, then register the active one.
    for (const [key, value] of Object.entries(index)) {
      if (value === botUserId) delete index[key];
    }
    index[token] = botUserId;
    await writeTokenIndex(index);
  }

  const credential: BotUploadCredential = {
    uploadUrl: `http://127.0.0.1:${port}/api/bot/upload`,
    token,
    publicBasePath: "/api/public/uploads",
  };
  await fs.writeFile(
    path.join(piDir, META_FILE),
    `${JSON.stringify(credential, null, 2)}\n`,
    { mode: 0o600 },
  );
  return credential;
}

export async function resolveBotUserIdByUploadToken(token: string): Promise<string | null> {
  const clean = token.trim();
  if (!clean || clean.length < 16) return null;
  const index = await readTokenIndex();
  return index[clean] ?? null;
}

/** Persist a bot upload outside the agent workspace; returns public path + id. */
export async function storeBotUpload(input: {
  botUserId: string;
  filename: string;
  content: Buffer;
  mimeType?: string;
}): Promise<{ id: string; filename: string; mimeType: string; size: number; publicPath: string }> {
  if (!input.content.length) {
    throw new Error("empty upload content");
  }
  if (input.content.length > 20 * 1024 * 1024) {
    throw new Error("upload exceeds 20MB limit");
  }
  const id = crypto.randomBytes(16).toString("hex");
  const filename = safeFilename(input.filename);
  const mimeType = guessMime(filename, input.mimeType);
  const dir = path.join(uploadsRoot(), id);
  await fs.mkdir(dir, { recursive: true });
  const storedPath = path.join(dir, filename);
  await fs.writeFile(storedPath, input.content);
  const meta: BotUploadMeta = {
    id,
    botUserId: input.botUserId,
    filename,
    mimeType,
    size: input.content.length,
    createdAt: Date.now(),
    storedPath,
  };
  await fs.writeFile(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return {
    id,
    filename,
    mimeType,
    size: meta.size,
    publicPath: `/api/public/uploads/${id}/${encodeURIComponent(filename)}`,
  };
}

export async function loadBotUpload(
  id: string,
): Promise<{ meta: BotUploadMeta; buffer: Buffer } | null> {
  if (!/^[a-f0-9]{32}$/i.test(id)) return null;
  const dir = path.join(uploadsRoot(), id);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8")) as BotUploadMeta;
    const buffer = await fs.readFile(meta.storedPath);
    return { meta, buffer };
  } catch {
    return null;
  }
}
