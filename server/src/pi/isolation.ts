import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import type { AuthSystem } from "../auth.js";
import { checkSensitivePath } from "./agent-sandbox.js";
import { resolveModelPolicy } from "../model-policy.js";
import {
  bundledExtensionsDir,
  bundledSubagentsPackageDir,
} from "../pi-extensions-path.js";

/** Subfolder under each user workspace where the agent cwd and Files panel root live. */
export const USER_PROJECTS_DIR = "projects";

export function agentCwdFromWorkspace(workspacePath: string): string {
  return path.join(workspacePath, USER_PROJECTS_DIR);
}

/** Per-user PI agent config dir (settings, auth, models registry). */
export function agentDirFromWorkspace(workspacePath: string): string {
  return path.join(workspacePath, ".pi", "agent");
}

/** Host-level PI agent dir — used only to seed credentials on first workspace init. */
export function globalAgentDir(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

export interface LastUsedModel {
  provider: string;
  modelId: string;
  timestamp: string;
}

/** Scan session jsonl files for the most recent model_change entry. */
export async function findLastUsedModelFromSessions(
  sessionsDir: string
): Promise<LastUsedModel | null> {
  let files: string[];
  try {
    files = await fs.readdir(sessionsDir);
  } catch {
    return null;
  }

  let latest: LastUsedModel | null = null;
  for (const name of files) {
    if (!name.endsWith(".jsonl")) continue;
    const content = await fs.readFile(path.join(sessionsDir, name), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.includes('"type":"model_change"')) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "model_change") continue;
      const provider = entry.provider;
      const modelId = entry.modelId;
      const timestamp = entry.timestamp;
      if (typeof provider !== "string" || typeof modelId !== "string") continue;
      if (typeof timestamp !== "string") continue;
      if (!latest || timestamp > latest.timestamp) {
        latest = { provider, modelId, timestamp };
      }
    }
  }
  return latest;
}

async function authJsonHasCredentials(filePath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as AuthJson;
    if (!parsed || typeof parsed !== "object") return false;
    return Object.values(parsed).some(
      (cred) => cred?.type === "api_key" && typeof cred.key === "string" && cred.key.trim().length > 0
    );
  } catch {
    return false;
  }
}

async function copySeedFileIfMissing(target: string, source: string): Promise<void> {
  try {
    await fs.access(target);
    return;
  } catch {
    // target missing — try to seed from global agent dir
  }
  try {
    await fs.access(source);
  } catch {
    return;
  }
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o600);
}

/** Seed auth.json when missing or empty ({}), e.g. after a failed first deploy. */
async function seedAgentAuthFromGlobal(agentAuthPath: string, globalAuthPath: string): Promise<void> {
  if (await authJsonHasCredentials(agentAuthPath)) return;
  try {
    await fs.access(globalAuthPath);
  } catch {
    await writeEmptyAuthIfMissing(agentAuthPath);
    return;
  }
  await fs.copyFile(globalAuthPath, agentAuthPath);
  await fs.chmod(agentAuthPath, 0o600);
}

async function writeEmptyAuthIfMissing(target: string): Promise<void> {
  try {
    await fs.access(target);
    return;
  } catch {
    // missing — write empty credential file
  }
  await fs.writeFile(target, "{}\n", "utf-8");
  await fs.chmod(target, 0o600);
}

type AuthJson = Record<string, { type?: string; key?: string }>;

/** Copy a single provider entry from host auth.json if missing in the user file. */
async function mergeProviderFromGlobalAuth(
  agentAuthPath: string,
  globalAuthPath: string,
  providerId: string
): Promise<void> {
  let globalAuth: AuthJson = {};
  try {
    globalAuth = JSON.parse(await fs.readFile(globalAuthPath, "utf-8")) as AuthJson;
  } catch {
    return;
  }
  const cred = globalAuth[providerId];
  if (!cred || cred.type !== "api_key" || typeof cred.key !== "string" || !cred.key.trim()) {
    return;
  }

  let agentAuth: AuthJson = {};
  try {
    agentAuth = JSON.parse(await fs.readFile(agentAuthPath, "utf-8")) as AuthJson;
  } catch {
    // start from empty
  }
  if (agentAuth[providerId]?.key) return;

  agentAuth[providerId] = cred;
  await fs.writeFile(agentAuthPath, `${JSON.stringify(agentAuth, null, 2)}\n`, "utf-8");
  await fs.chmod(agentAuthPath, 0o600);
}

/** Supplemental providers always seeded from host auth (even for restricted users). */
const SEED_PROVIDERS_FROM_GLOBAL = ["jina"] as const;

async function shouldCopyExtensionEntry(source: string, target: string): Promise<boolean> {
  try {
    const srcStat = await fs.stat(source);
    let dstStat;
    try {
      dstStat = await fs.stat(target);
    } catch {
      return true;
    }
    return dstStat.mtimeMs < srcStat.mtimeMs || dstStat.size !== srcStat.size;
  } catch {
    return false;
  }
}

async function copyExtensionEntryIfStale(source: string, target: string): Promise<void> {
  if (!(await shouldCopyExtensionEntry(source, target))) return;
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o644);
}

async function syncExtensionTree(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await syncExtensionTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyExtensionEntryIfStale(sourcePath, targetPath);
    }
  }
}

/**
 * Mirror bundled repo extensions (`pi-extensions/extensions/`) into the per-user agent dir.
 * Copies missing entries and refreshes files when the bundled copy is newer.
 */
export async function syncBundledAgentExtensions(agentDir: string): Promise<void> {
  const sourceDir = bundledExtensionsDir(config.piExtensionsRoot);
  try {
    await fs.access(sourceDir);
  } catch {
    return;
  }
  await syncExtensionTree(sourceDir, path.join(agentDir, "extensions"));
}

/**
 * @deprecated Use {@link syncBundledAgentExtensions}. Kept for tests that pass a custom source dir.
 */
export async function syncAgentExtensionsFromGlobal(
  agentDir: string,
  globalDir: string = globalAgentDir()
): Promise<void> {
  const sourceDir = path.join(globalDir, "extensions");
  try {
    await fs.access(sourceDir);
  } catch {
    return;
  }
  await syncExtensionTree(sourceDir, path.join(agentDir, "extensions"));
}

/** Ensure settings.json lists bundled pi-subagents-h (PI package, not under extensions/). */
export async function mergeBundledPackagesIntoSettings(settingsPath: string): Promise<void> {
  const pkgDir = path.resolve(bundledSubagentsPackageDir(config.piExtensionsRoot));
  try {
    await fs.access(pkgDir);
  } catch {
    return;
  }

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch {
    // new or invalid — rewrite below
  }

  const packages = Array.isArray(settings.packages)
    ? [...(settings.packages as string[])]
    : [];
  if (!packages.includes(pkgDir)) {
    packages.push(pkgDir);
  }
  settings.packages = packages;
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

export interface EnsureUserAgentDirOptions {
  /** When false, seed empty auth.json instead of copying host credentials. */
  seedAuthFromGlobal?: boolean;
}

/**
 * Ensure each user has an isolated PI agent dir under their workspace.
 * Seeds auth/models from the host ~/.pi/agent on first init; syncs bundled
 * extensions from repo `pi-extensions/` on every call; restores last-used model
 * from session history when creating settings.json for existing users.
 */
export async function ensureUserAgentDir(
  workspacePath: string,
  options?: EnsureUserAgentDirOptions
): Promise<string> {
  const agentDir = agentDirFromWorkspace(workspacePath);
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

  const globalDir = globalAgentDir();
  const seedAuthFromGlobal = options?.seedAuthFromGlobal !== false;
  if (seedAuthFromGlobal) {
    const agentAuthPath = path.join(agentDir, "auth.json");
    const globalAuthPath = path.join(globalDir, "auth.json");
    await seedAgentAuthFromGlobal(agentAuthPath, globalAuthPath);
  } else {
    await writeEmptyAuthIfMissing(path.join(agentDir, "auth.json"));
  }
  await copySeedFileIfMissing(path.join(agentDir, "models.json"), path.join(globalDir, "models.json"));
  const agentAuthPath = path.join(agentDir, "auth.json");
  for (const providerId of SEED_PROVIDERS_FROM_GLOBAL) {
    await mergeProviderFromGlobalAuth(agentAuthPath, path.join(globalDir, "auth.json"), providerId);
  }
  await syncBundledAgentExtensions(agentDir);

  const settingsPath = path.join(agentDir, "settings.json");
  try {
    await fs.access(settingsPath);
  } catch {
    const sessionsDir = path.join(workspacePath, ".pi", "sessions");
    const lastModel = await findLastUsedModelFromSessions(sessionsDir);
    const settings: Record<string, unknown> = {};
    if (lastModel) {
      settings.defaultProvider = lastModel.provider;
      settings.defaultModel = lastModel.modelId;
    }
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
  await mergeBundledPackagesIntoSettings(settingsPath);

  return agentDir;
}

/** Move workspace-root Memories.md into projects/ (one-time per user). */
export async function migrateLegacyMemoryFiles(userDir: string): Promise<void> {
  const projectsDir = path.join(userDir, USER_PROJECTS_DIR);
  await fs.mkdir(projectsDir, { recursive: true });
  for (const name of ["Memories.md"] as const) {
    const legacy = path.join(userDir, name);
    const target = path.join(projectsDir, name);
    try {
      await fs.access(legacy);
    } catch {
      continue;
    }
    try {
      await fs.access(target);
      await fs.unlink(legacy);
    } catch {
      await fs.rename(legacy, target);
    }
  }
}

export class WorkspaceIsolator {
  private root: string;
  private authSystem: AuthSystem;

  constructor(authSystem: AuthSystem) {
    this.root = path.resolve(config.workspaceRoot);
    this.authSystem = authSystem;
  }

  async ensureUserWorkspace(userId: string): Promise<string> {
    const dirName = this.authSystem.getWorkspaceDirName(userId);
    await this.migrateLegacyDir(userId, dirName);
    const userDir = path.join(this.root, dirName);
    const exportsDir = path.join(userDir, ".pi", "exports");
    await fs.mkdir(path.join(userDir, ".pi", "skills"), { recursive: true });
    await fs.mkdir(exportsDir, { recursive: true });
    await fs.mkdir(path.join(userDir, USER_PROJECTS_DIR), { recursive: true });

    const settingsPath = path.join(userDir, ".pi", "settings.json");
    try {
      await fs.access(settingsPath);
    } catch {
      await fs.writeFile(
        settingsPath,
        JSON.stringify(
          { compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2 } },
          null,
          2
        )
      );
    }

    await this.migrateLegacyExports(userDir, exportsDir);
    await migrateLegacyMemoryFiles(userDir);

    const user = this.authSystem.getUser(userId);
    const policy = resolveModelPolicy(user, this.authSystem.isAdmin(userId));
    await ensureUserAgentDir(userDir, { seedAuthFromGlobal: policy.unrestricted });

    return userDir;
  }

  // One-time cleanup for workspaces created before exports moved under
  // .pi/exports/ — old session-export-* files sat in the workspace root
  // where the user could see them mixed in with their own files.
  private async migrateLegacyExports(userDir: string, exportsDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(userDir);
      for (const name of entries) {
        if (!name.startsWith("session-export-")) continue;
        await fs.rename(path.join(userDir, name), path.join(exportsDir, name));
      }
    } catch {
      // Best-effort; a stray legacy export file isn't worth failing workspace init over.
    }
  }

  // One-time cleanup for workspaces created before folders were named after
  // the account (display name + random suffix) — they still sit under the
  // raw userId UUID on disk. Renames the whole tree into place the first
  // time this user's workspace is touched after upgrading.
  private async migrateLegacyDir(userId: string, dirName: string): Promise<void> {
    if (dirName === userId) return;
    const legacyDir = path.join(this.root, userId);
    const newDir = path.join(this.root, dirName);
    try {
      await fs.access(legacyDir);
    } catch {
      return; // nothing legacy to migrate
    }
    try {
      await fs.access(newDir);
      return; // already migrated
    } catch {
      await fs.rename(legacyDir, newDir);
    }
  }

  getUserWorkspace(userId: string): string {
    return path.join(this.root, this.authSystem.getWorkspaceDirName(userId));
  }

  /**
   * The dedicated folder the user actually browses/edits in (the Files
   * panel, editor, etc). Kept separate from the workspace root so platform
   * internals — `.pi/` session data, settings, exports — never show up
   * alongside the user's own files.
   */
  getVisibleRoot(userId: string): string {
    return path.join(this.getUserWorkspace(userId), USER_PROJECTS_DIR);
  }

  /** Pi agent cwd — same tree the Files panel lists. */
  getAgentCwd(userId: string): string {
    return this.getVisibleRoot(userId);
  }

  /** Per-user PI agent config dir (isolated settings/auth/models). */
  getAgentDir(userId: string): string {
    return agentDirFromWorkspace(this.getUserWorkspace(userId));
  }

  agentCwdFromWorkspace(workspacePath: string): string {
    return agentCwdFromWorkspace(workspacePath);
  }

  validatePath(userId: string, targetPath: string): string {
    const root = this.getVisibleRoot(userId);
    const resolved = path.resolve(root, targetPath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error("Path traversal denied");
    }
    return resolved;
  }

  checkSensitive(targetPath: string): void {
    checkSensitivePath(targetPath);
  }
}
