import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { UserAccount, UserRole, UserSession } from "./types.js";
import { config } from "./config.js";
import { getUserRepository, createIsolatedUserRepository } from "./db/index.js";
import type { UserRepository } from "./db/user-repository.js";
import {
  assertValidModelTemplateId,
  normalizeModelTemplateId,
} from "./model-policy.js";
import { computeApiKeyLookup } from "./api-key-lookup.js";

const BCRYPT_ROUNDS = 12;

function idleSessionTimeoutMs(): number | null {
  if (config.sessionTimeoutHours <= 0) return null;
  return config.sessionTimeoutHours * 60 * 60 * 1000;
}

function maxSessionLifetimeMs(): number | null {
  if (config.sessionMaxHours <= 0) return null;
  return config.sessionMaxHours * 60 * 60 * 1000;
}
const API_KEY_PREFIX = "sk-hyw-";
const API_KEY_RANDOM_LEN = 16;
const API_KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const API_KEY_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const API_KEY_DIGITS = "23456789";

const WORKSPACE_SUFFIX_LEN = 8;
const WORKSPACE_SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export type PublicUser = Omit<UserAccount, "apiKeyHash" | "apiKeyLookup">;

export interface CreateUserOptions {
  username?: string;
  role?: UserRole;
  /** Initial budget cap in USD; omit or null = unlimited for admin, $2 for users. */
  budgetUsd?: number | null;
  /** Model template id; omit/null/"full" = unrestricted. */
  modelTemplateId?: string | null;
}

function slugifyDisplayName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "user";
}

function randomWorkspaceSuffix(): string {
  const bytes = randomBytes(WORKSPACE_SUFFIX_LEN);
  let out = "";
  for (let i = 0; i < WORKSPACE_SUFFIX_LEN; i++) {
    out += WORKSPACE_SUFFIX_CHARS[bytes[i]! % WORKSPACE_SUFFIX_CHARS.length];
  }
  return out;
}

function makeWorkspaceDir(displayName: string): string {
  return `${slugifyDisplayName(displayName)}-${randomWorkspaceSuffix()}`;
}

function normalizeRole(role?: UserRole): UserRole {
  return role === "admin" || role === "bot" ? role : "user";
}

function defaultBudgetUsd(role?: UserRole): number | null {
  return normalizeRole(role) === "admin" ? null : config.defaultBudgetUsd;
}

export function isUnlimitedBudget(user: Pick<UserAccount, "role" | "budgetUsd">): boolean {
  return normalizeRole(user.role) === "admin" || user.budgetUsd === null;
}

export function budgetSnapshot(user: Pick<UserAccount, "role" | "budgetUsd" | "budgetUsedUsd">) {
  const unlimited = isUnlimitedBudget(user);
  const budgetUsedUsd = user.budgetUsedUsd ?? 0;
  const cap = user.budgetUsd;
  return {
    budgetUsd: unlimited ? null : cap,
    budgetUsedUsd,
    budgetRemainingUsd: unlimited || cap === null ? null : Math.max(0, cap - budgetUsedUsd),
    budgetUnlimited: unlimited,
  };
}

function resolveUsername(user: Pick<UserAccount, "username" | "displayName">): string {
  return user.username?.trim() || user.displayName;
}

function toPublicUser(user: UserAccount): PublicUser {
  const { apiKeyHash: _, apiKeyLookup: __, ...rest } = user;
  return {
    ...rest,
    username: resolveUsername(user),
    role: normalizeRole(user.role),
  };
}

export function generateApiKey(): string {
  const bytes = randomBytes(API_KEY_RANDOM_LEN);
  let suffix =
    API_KEY_LETTERS[bytes[0]! % API_KEY_LETTERS.length]! +
    API_KEY_DIGITS[bytes[1]! % API_KEY_DIGITS.length]!;
  for (let i = 2; i < API_KEY_RANDOM_LEN; i++) {
    suffix += API_KEY_CHARS[bytes[i]! % API_KEY_CHARS.length];
  }
  return API_KEY_PREFIX + suffix;
}

export interface AuthSystemOptions {
  /** Isolated DB path (tests). Omit to use shared platform.db. */
  databasePath?: string;
}

export class AuthSystem {
  private users: Map<string, UserAccount> = new Map();
  private sessions: Map<string, UserSession> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private repo: UserRepository;
  private roleChangeListeners: Array<(userId: string) => void | Promise<void>> = [];
  private modelTemplateChangeListeners: Array<(userId: string) => void | Promise<void>> = [];

  constructor(options?: AuthSystemOptions) {
    this.repo = options?.databasePath
      ? createIsolatedUserRepository(options.databasePath)
      : getUserRepository();
    this.loadUsers();
    this.migrateUsers();
    this.repo.backfillApiKeyLookups(computeApiKeyLookup);
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 15 * 60 * 1000);
  }

  private loadUsers(): void {
    this.users.clear();
    for (const u of this.repo.findAll()) {
      this.users.set(u.userId, u);
    }
  }

  private migrateUsers(): void {
    let changed = false;
    for (const user of this.users.values()) {
      if (!user.role) {
        user.role = user.displayName === "Admin" ? "admin" : "user";
        changed = true;
      }
      if (!user.username) {
        user.username = slugifyDisplayName(user.displayName) || user.displayName;
        changed = true;
      }
      if (user.budgetUsd === undefined) {
        user.budgetUsd = defaultBudgetUsd(user.role);
        changed = true;
      } else if (normalizeRole(user.role) === "admin" && user.budgetUsd !== null) {
        user.budgetUsd = null;
        changed = true;
      }
      if (user.budgetUsedUsd == null) {
        user.budgetUsedUsd = 0;
        changed = true;
      }
    }
    if (!this.hasAdminUser() && this.users.size > 0) {
      const first = Array.from(this.users.values()).find((user) => normalizeRole(user.role) !== "bot");
      if (first) {
        first.role = "admin";
        changed = true;
      }
    }
    if (changed) this.persistAllUsers();
  }

  private persistUser(user: UserAccount): void {
    this.users.set(user.userId, user);
    if (this.repo.findById(user.userId)) {
      this.repo.update(user);
    } else {
      this.repo.insert(user);
    }
  }

  private persistAllUsers(): void {
    for (const user of this.users.values()) {
      if (this.repo.findById(user.userId)) this.repo.update(user);
      else this.repo.insert(user);
    }
  }

  /** Fired after role change is persisted — use to reload agent admin skills. */
  onUserRoleChanged(listener: (userId: string) => void | Promise<void>): void {
    this.roleChangeListeners.push(listener);
  }

  /** Fired after model template change — use to reload agent model policy. */
  onUserModelTemplateChanged(listener: (userId: string) => void | Promise<void>): void {
    this.modelTemplateChangeListeners.push(listener);
  }

  private async emitUserModelTemplateChanged(userId: string): Promise<void> {
    for (const listener of this.modelTemplateChangeListeners) {
      await listener(userId);
    }
  }

  private async emitUserRoleChanged(userId: string): Promise<void> {
    for (const listener of this.roleChangeListeners) {
      await listener(userId);
    }
  }

  private syncAuthSessionsForUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      session.role = normalizeRole(user.role);
      session.displayName = user.displayName;
      session.username = resolveUsername(user);
    }
  }

  hasAdminUser(): boolean {
    return Array.from(this.users.values()).some((u) => normalizeRole(u.role) === "admin");
  }

  isAdmin(userId: string): boolean {
    const user = this.users.get(userId);
    return user ? normalizeRole(user.role) === "admin" : false;
  }

  /** Keep in-memory cache aligned when users are added outside this process (offline CLI, etc.). */
  private cacheUser(user: UserAccount): UserAccount {
    this.users.set(user.userId, user);
    return user;
  }

  async findUserByApiKey(apiKey: string): Promise<UserAccount | null> {
    const lookup = computeApiKeyLookup(apiKey);
    const candidate = this.repo.findByApiKeyLookup(lookup);
    if (candidate) {
      if (await bcrypt.compare(apiKey, candidate.apiKeyHash)) {
        return this.cacheUser(candidate);
      }
      return null;
    }

    for (const user of this.users.values()) {
      if (await bcrypt.compare(apiKey, user.apiKeyHash)) {
        if (!user.apiKeyLookup) {
          user.apiKeyLookup = lookup;
          this.persistUser(user);
        }
        return user;
      }
    }
    return null;
  }

  async verifyAdminApiKey(apiKey: string): Promise<UserAccount | null> {
    const user = await this.findUserByApiKey(apiKey);
    if (!user || normalizeRole(user.role) !== "admin") return null;
    return user;
  }

  /** Plaintext API key stored for AI / automation (admin-managed accounts). */
  getStoredApiKey(userId: string): string | null {
    return this.repo.getStoredApiKey(userId);
  }

  /** First admin's stored key, if any. */
  getPrimaryAdminStoredApiKey(): string | null {
    for (const user of this.users.values()) {
      if (normalizeRole(user.role) !== "admin") continue;
      const key = this.repo.getStoredApiKey(user.userId);
      if (key) return key;
    }
    return null;
  }

  private storeApiKeyPlain(userId: string, plainKey: string): void {
    this.repo.setStoredApiKey(userId, plainKey);
  }

  async createUser(
    apiKey: string | undefined,
    displayName: string,
    options: CreateUserOptions = {}
  ): Promise<{ user: UserAccount; plainKey: string }> {

    const plainKey = apiKey?.trim() || generateApiKey();
    if (!this.validateApiKeyFormat(plainKey)) {
      throw new Error("API key must be at least 16 characters with letters and numbers");
    }

    const username = options.username?.trim() || slugifyDisplayName(displayName) || displayName;
    if (this.findUserByUsername(username)) {
      throw new Error(`Username already exists: ${username}`);
    }

    const role = normalizeRole(options.role);
    const modelTemplateId = normalizeModelTemplateId(options.modelTemplateId);
    if (modelTemplateId) assertValidModelTemplateId(modelTemplateId);

    const userId = randomUUID();
    const apiKeyHash = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);
    const apiKeyLookup = computeApiKeyLookup(plainKey);

    const user: UserAccount = {
      userId,
      apiKeyHash,
      apiKeyLookup,
      displayName,
      username,
      role,
      createdAt: Date.now(),
      tokensUsed: 0,
      budgetUsd:
        options.budgetUsd !== undefined
          ? options.budgetUsd
          : defaultBudgetUsd(role),
      budgetUsedUsd: 0,
      workspaceDir: makeWorkspaceDir(displayName),
      modelTemplateId: modelTemplateId ?? undefined,
    };

    this.persistUser(user);
    this.storeApiKeyPlain(userId, plainKey);
    return { user, plainKey };
  }

  findUserByUsername(username: string): UserAccount | undefined {
    const needle = username.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (resolveUsername(user).toLowerCase() === needle) return user;
    }
    return undefined;
  }

  async login(apiKey: string): Promise<UserSession> {
    const user = await this.findUserByApiKey(apiKey);
    if (!user) throw new Error("hmm...? Invalid API key");
    return this.createSession(user);
  }

  private createSession(user: UserAccount): UserSession {
    const now = Date.now();
    const session: UserSession = {
      sessionId: randomUUID(),
      userId: user.userId,
      displayName: user.displayName,
      username: resolveUsername(user),
      role: normalizeRole(user.role),
      createdAt: now,
      lastActivity: now,
      expiresAt: now + (maxSessionLifetimeMs() ?? Number.MAX_SAFE_INTEGER - now),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  validateSession(sessionId: string): UserSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const now = Date.now();
    const maxLifetimeMs = maxSessionLifetimeMs();
    if (maxLifetimeMs !== null && now > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    const idleMs = idleSessionTimeoutMs();
    if (idleMs !== null && now - session.lastActivity > idleMs) {
      this.sessions.delete(sessionId);
      return null;
    }

    session.lastActivity = now;
    return session;
  }

  logout(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getUser(userId: string): UserAccount | undefined {
    const cached = this.users.get(userId);
    if (cached) return cached;
    const fromDb = this.repo.findById(userId);
    if (!fromDb) return undefined;
    return this.cacheUser(fromDb);
  }

  getWorkspaceDirName(userId: string): string {
    const user = this.users.get(userId);
    if (!user) return userId;
    if (!user.workspaceDir) {
      user.workspaceDir = makeWorkspaceDir(user.displayName);
      this.persistUser(user);
    }
    return user.workspaceDir;
  }

  addTokenUsage(userId: string, tokens: number): UserAccount | undefined {
    const user = this.users.get(userId);
    if (user) user.tokensUsed += tokens;
    return user;
  }

  persistTokenUsage(userId: string, tokens: number): UserAccount | undefined {
    const user = this.addTokenUsage(userId, tokens);
    if (user) this.persistUser(user);
    return user;
  }

  addBudgetUsage(userId: string, costUsd: number): UserAccount | undefined {
    const user = this.users.get(userId);
    if (user) user.budgetUsedUsd = (user.budgetUsedUsd ?? 0) + costUsd;
    return user;
  }

  persistTurnSpend(userId: string, tokens: number, costUsd: number): UserAccount | undefined {
    const user = this.addTokenUsage(userId, tokens);
    if (user) user.budgetUsedUsd = (user.budgetUsedUsd ?? 0) + costUsd;
    if (user) this.persistUser(user);
    return user;
  }

  hasBudget(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    if (isUnlimitedBudget(user)) return true;
    const cap = user.budgetUsd ?? config.defaultBudgetUsd;
    return (user.budgetUsedUsd ?? 0) < cap;
  }

  addBudget(userId: string, amountUsd: number): PublicUser {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error("amountUsd must be a positive number");
    }
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    user.budgetUsd = (user.budgetUsd ?? config.defaultBudgetUsd) + amountUsd;
    this.persistUser(user);
    return toPublicUser(user);
  }

  hasTokens(userId: string): boolean {
    return this.hasBudget(userId);
  }

  getAllUsers(): PublicUser[] {
    return Array.from(this.users.values()).map(toPublicUser);
  }

  updateUser(
    userId: string,
    patch: Partial<
      Pick<
        UserAccount,
        | "displayName"
        | "username"
        | "role"
        | "systemPrompt"
        | "budgetUsd"
        | "budgetUsedUsd"
        | "modelTemplateId"
        | "modelAllow"
      >
    >
  ): PublicUser {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");

    if (patch.username !== undefined) {
      const next = patch.username.trim();
      if (!next) throw new Error("username cannot be empty");
      const existing = this.findUserByUsername(next);
      if (existing && existing.userId !== userId) {
        throw new Error(`Username already exists: ${next}`);
      }
      user.username = next;
    }

    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.systemPrompt !== undefined) user.systemPrompt = patch.systemPrompt;
    if (patch.budgetUsd !== undefined) {
      if (patch.budgetUsd !== null && patch.budgetUsd < 0) {
        throw new Error("budgetUsd cannot be negative");
      }
      user.budgetUsd = patch.budgetUsd;
    }
    if (patch.budgetUsedUsd !== undefined) {
      if (patch.budgetUsedUsd < 0) throw new Error("budgetUsedUsd cannot be negative");
      user.budgetUsedUsd = patch.budgetUsedUsd;
    }

    let modelPolicyChanged = false;
    if (patch.modelTemplateId !== undefined) {
      const next = normalizeModelTemplateId(patch.modelTemplateId);
      if (next) assertValidModelTemplateId(next);
      const prev = normalizeModelTemplateId(user.modelTemplateId);
      if (next !== prev) modelPolicyChanged = true;
      user.modelTemplateId = next ?? undefined;
    }

    if (patch.modelAllow !== undefined) {
      const nextJson = JSON.stringify(patch.modelAllow ?? null);
      const prevJson = JSON.stringify(user.modelAllow ?? null);
      if (nextJson !== prevJson) modelPolicyChanged = true;
      user.modelAllow = patch.modelAllow ?? undefined;
    }

    let roleChanged = false;
    if (patch.role !== undefined) {
      const nextRole = normalizeRole(patch.role);
      if (nextRole === "user" && normalizeRole(user.role) === "admin" && this.countAdmins() <= 1) {
        throw new Error("Cannot demote the last admin user");
      }
      if (nextRole !== normalizeRole(user.role)) roleChanged = true;
      user.role = nextRole;
      if (nextRole === "admin") {
        user.budgetUsd = null;
      } else if (user.budgetUsd === null) {
        user.budgetUsd = config.defaultBudgetUsd;
      }
    }

    this.syncAuthSessionsForUser(userId);
    this.persistUser(user);

    if (roleChanged) {
      void this.emitUserRoleChanged(userId);
    }
    if (modelPolicyChanged) {
      void this.emitUserModelTemplateChanged(userId);
    }

    return toPublicUser(user);
  }

  private countAdmins(): number {
    return Array.from(this.users.values()).filter((u) => normalizeRole(u.role) === "admin").length;
  }

  deleteUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    if (normalizeRole(user.role) === "admin" && this.countAdmins() <= 1) {
      throw new Error("Cannot delete the last admin user");
    }
    this.users.delete(userId);
    this.repo.delete(userId);
    for (const [sid, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(sid);
    }
  }

  async rotateApiKey(userId: string): Promise<{ plainKey: string; user: PublicUser }> {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    const plainKey = generateApiKey();
    user.apiKeyHash = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);
    user.apiKeyLookup = computeApiKeyLookup(plainKey);
    this.persistUser(user);
    this.storeApiKeyPlain(userId, plainKey);
    for (const [sid, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(sid);
    }
    return { plainKey, user: toPublicUser(user) };
  }

  getActiveSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  private validateApiKeyFormat(key: string): boolean {
    if (key.length < 16) return false;
    return /[a-zA-Z]/.test(key) && /[0-9]/.test(key);
  }

  private cleanupSessions(): void {
    const now = Date.now();
    const idleMs = idleSessionTimeoutMs();
    const maxLifetimeMs = maxSessionLifetimeMs();
    for (const [id, session] of this.sessions) {
      if (maxLifetimeMs !== null && now > session.expiresAt) {
        this.sessions.delete(id);
        continue;
      }
      if (idleMs !== null && now - session.lastActivity > idleMs) {
        this.sessions.delete(id);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
  }
}
