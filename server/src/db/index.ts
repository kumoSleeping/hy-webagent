import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { openUserRepository, type UserRepository } from "./user-repository.js";

const DEFAULT_DB_PATH = path.join(process.cwd(), "..", "data", "platform.db");
const LEGACY_USERS_JSON = path.join(process.cwd(), "..", "data", "users.json");
const LEGACY_ADMIN_KEY_FILE = path.join(process.cwd(), "..", "data", "admin-key.txt");

let sharedRepo: UserRepository | null = null;

function migrateLegacyAdminKeyFile(repo: UserRepository): void {
  let plainKey: string;
  try {
    plainKey = fs.readFileSync(LEGACY_ADMIN_KEY_FILE, "utf-8").trim();
  } catch {
    return;
  }
  if (!plainKey) return;

  const admins = repo.findAll().filter((u) => u.role === "admin");
  if (admins.length === 0) return;

  const admin = admins[0]!;
  if (repo.getStoredApiKey(admin.userId)) return;

  repo.setStoredApiKey(admin.userId, plainKey);
  console.log(`[platform-db] imported legacy admin API key from data/admin-key.txt into database`);
}

export function getUserRepository(dbPath?: string): UserRepository {
  if (!sharedRepo) {
    const resolved = dbPath ?? config.databasePath;
    sharedRepo = openUserRepository(resolved);
    const migrated = sharedRepo.migrateFromJson(LEGACY_USERS_JSON);
    if (migrated > 0) {
      console.log(`[platform-db] migrated ${migrated} user(s) from data/users.json → ${resolved}`);
    }
    migrateLegacyAdminKeyFile(sharedRepo);
  }
  return sharedRepo;
}

/** Test helper — reset singleton between tests. */
export function resetUserRepositoryForTests(): void {
  sharedRepo?.close();
  sharedRepo = null;
}

export function createIsolatedUserRepository(dbPath: string): UserRepository {
  return openUserRepository(dbPath);
}
