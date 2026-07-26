import fs from "node:fs/promises";
import fsSync from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import type { AuthSystem } from "../auth.js";
import { checkSensitivePath } from "./agent-sandbox.js";
import { resolveModelPolicy } from "../model-policy.js";
import { bundledExtensionsDir } from "../pi-extensions-path.js";

/** Platform-managed PI packages — same sources as a modern local `~/.pi/agent/settings.json`. */
export const PLATFORM_NPM_PACKAGES = [
  "npm:pi-subagents",
  "npm:@howaboua/pi-codex-conversion@2.2.19",
] as const;

const LEGACY_PACKAGE_MARKERS = ["pi-subagents-h", "packages/pi-subagents-h"];

/** Subfolder under each user workspace where the agent cwd and Files panel root live. */
export const USER_PROJECTS_DIR = "projects";

/** Chat image uploads (relative to projects/). */
export const USER_PICTURES_DIR = "Pictures";

/** Strip redundant `projects/` prefixes — models often emit paths like `projects/foo.pdf`. */
export function normalizeProjectsRelativePath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  while (p.startsWith(`${USER_PROJECTS_DIR}/`)) {
    p = p.slice(USER_PROJECTS_DIR.length + 1);
  }
  return p;
}

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

/** Always refresh workspace models.json from host (custom providers / API keys). */
async function syncModelsJsonFromGlobal(target: string, source: string): Promise<void> {
  try {
    await fs.access(source);
  } catch {
    return;
  }
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o600);
}

async function migrateSoruxDefaultProvider(settingsPath: string): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }
  if (settings.defaultProvider !== "soruxgpt") return;
  settings.defaultProvider = "xai";
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
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

/** Drop bundled extension entries removed from the repo mirror (e.g. retired btw-h). */
async function pruneExtensionTreeOrphans(sourceDir: string, targetDir: string): Promise<void> {
  let targetEntries: Dirent[];
  try {
    targetEntries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch {
    return;
  }
  let sourceNames: Set<string>;
  try {
    sourceNames = new Set(await fs.readdir(sourceDir));
  } catch {
    return;
  }

  for (const entry of targetEntries) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    if (!sourceNames.has(entry.name)) {
      await fs.rm(targetPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      await pruneExtensionTreeOrphans(sourcePath, targetPath);
    }
  }
}

/**
 * Mirror bundled repo extensions (`pi-extensions/extensions/`) into the per-user agent dir.
 * Copies missing entries, refreshes files when the bundled copy is newer, and removes
 * entries retired from the bundle so stale copies (e.g. btw-h) do not linger in workspaces.
 */
export async function syncBundledAgentExtensions(agentDir: string): Promise<void> {
  const sourceDir = bundledExtensionsDir(config.piExtensionsRoot);
  try {
    await fs.access(sourceDir);
  } catch {
    return;
  }
  const targetDir = path.join(agentDir, "extensions");
  await syncExtensionTree(sourceDir, targetDir);
  await pruneExtensionTreeOrphans(sourceDir, targetDir);
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

function isLegacySubagentsPackage(entry: string): boolean {
  const normalized = entry.replace(/\\/g, "/");
  return LEGACY_PACKAGE_MARKERS.some((m) => normalized.includes(m));
}

/**
 * Ensure settings.json uses `npm:pi-subagents` (official package) and drops
 * legacy path-based `pi-subagents-h` entries.
 */
export async function mergeBundledPackagesIntoSettings(settingsPath: string): Promise<void> {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch {
    // new or invalid — rewrite below
  }

  const existing = Array.isArray(settings.packages)
    ? (settings.packages as string[])
    : [];
  const packages = existing.filter((p) => !isLegacySubagentsPackage(p));
  for (const spec of PLATFORM_NPM_PACKAGES) {
    if (!packages.includes(spec)) packages.push(spec);
  }
  settings.packages = packages;
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Copy host-managed npm PI packages into the user agent dir so `npm:…` settings
 * resolve without each workspace installing from the network.
 * Source: `~/.pi/agent/npm` (same layout as local PI CLI).
 */
export async function seedManagedNpmPackages(agentDir: string): Promise<void> {
  const globalNpm = path.join(globalAgentDir(), "npm");
  try {
    await fs.access(path.join(globalNpm, "node_modules", "pi-subagents"));
    await fs.access(path.join(globalNpm, "node_modules", "@howaboua", "pi-codex-conversion"));
  } catch {
    return;
  }

  const userNpm = path.join(agentDir, "npm");
  try {
    const stat = await fs.lstat(userNpm);
    if (stat.isSymbolicLink() && path.resolve(path.dirname(userNpm), await fs.readlink(userNpm)) === globalNpm) {
      return;
    }
    await fs.rm(userNpm, { recursive: true, force: true });
  } catch {
    // missing — create the managed link below
  }
  await fs.mkdir(path.dirname(userNpm), { recursive: true, mode: 0o700 });
  await fs.symlink(globalNpm, userNpm, "dir");
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
  await syncModelsJsonFromGlobal(path.join(agentDir, "models.json"), path.join(globalDir, "models.json"));
  const agentAuthPath = path.join(agentDir, "auth.json");
  for (const providerId of SEED_PROVIDERS_FROM_GLOBAL) {
    await mergeProviderFromGlobalAuth(agentAuthPath, path.join(globalDir, "auth.json"), providerId);
  }
  await syncBundledAgentExtensions(agentDir);
  await seedManagedNpmPackages(agentDir);

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
  await migrateSoruxDefaultProvider(settingsPath);
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
    await fs.mkdir(path.join(userDir, USER_PROJECTS_DIR, USER_PICTURES_DIR), { recursive: true });

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

  /**
   * Resolve a user-supplied path and prove it stays inside that user's visible root.
   *
   * A lexical `path.resolve` prefix check alone is not containment: every fs call
   * downstream follows symlinks, so a link created inside the workspace (the
   * user's own agent can run `ln -s`) makes an in-bounds string resolve to an
   * out-of-bounds file. We therefore also resolve symlinks on the real path.
   *
   * The target may legitimately not exist yet (create/write/rename destinations),
   * so when it is missing we walk up to the nearest existing ancestor, resolve
   * that, and re-apply the remaining segments — which is enough to catch a
   * symlinked parent directory.
   */
  validatePath(userId: string, targetPath: string): string {
    const root = this.getVisibleRoot(userId);
    const resolved = path.resolve(root, targetPath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error("Path traversal denied");
    }

    // The root itself may sit behind a symlink (e.g. /var -> /private/var on
    // macOS); compare like for like.
    let realRoot: string;
    try {
      realRoot = fsSync.realpathSync.native(root);
    } catch {
      realRoot = root;
    }

    const trailing: string[] = [];
    let probe = resolved;
    for (;;) {
      try {
        const realProbe = fsSync.realpathSync.native(probe);
        // `trailing` collects basenames deepest-first as we walk up; rebuild the
        // descent order without mutating it, since this runs inside the loop.
        const candidate = path.resolve(realProbe, ...[...trailing].reverse());
        if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
          throw new Error("Path traversal denied");
        }
        return resolved;
      } catch (err) {
        if ((err as Error).message === "Path traversal denied") throw err;
        const parent = path.dirname(probe);
        if (parent === probe) {
          // Walked past the filesystem root without finding anything real.
          throw new Error("Path traversal denied");
        }
        trailing.push(path.basename(probe));
        probe = parent;
      }
    }
  }

  checkSensitive(targetPath: string): void {
    checkSensitivePath(targetPath);
  }
}
