import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const SECRET_FILE = path.join(path.dirname(config.databasePath), ".api-key-lookup-secret");

let cachedSecret: string | null = null;

function readPersistedSecret(): string | undefined {
  try {
    const value = fs.readFileSync(SECRET_FILE, "utf-8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function persistSecret(secret: string): void {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
}

export function resolveApiKeyLookupSecret(): string {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.API_KEY_LOOKUP_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  const persisted = readPersistedSecret();
  if (persisted) {
    cachedSecret = persisted;
    return cachedSecret;
  }

  const generated = randomBytes(32).toString("hex");
  persistSecret(generated);
  cachedSecret = generated;
  return cachedSecret;
}

export function resetApiKeyLookupSecretForTests(): void {
  cachedSecret = null;
}

export function computeApiKeyLookup(apiKey: string): string {
  return createHmac("sha256", resolveApiKeyLookupSecret()).update(apiKey).digest("hex");
}
