import "dotenv/config";
import { resolveAdminKey } from "./admin-key.js";
import { defaultPiExtensionsRoot } from "./pi-extensions-path.js";

export const config = {
  port: Number(process.env.PORT) || 3001,
  /** Optional master key (ADMIN_KEY). Null disables master-key admin auth. */
  adminKey: resolveAdminKey(),
  workspaceRoot: process.env.WORKSPACE_ROOT || pathJoin(process.cwd(), "..", "workspaces"),
  maxConcurrentUsers: Number(process.env.MAX_CONCURRENT_USERS) || 4,
  /** 0 = no idle expiry (multi-browser / long-lived sessions). */
  sessionTimeoutHours: Number(process.env.SESSION_TIMEOUT_HOURS ?? 0),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
  /** Absolute session lifetime (hours). 0 = no limit. */
  sessionMaxHours: Number(process.env.SESSION_MAX_HOURS ?? 0),
  /** Allow WebSocket upgrade without Origin (dev/tools only). */
  wsAllowNoOrigin: process.env.WS_ALLOW_NO_ORIGIN === "true",
  /** Default API key budget for new users (USD). */
  defaultBudgetUsd: Number(process.env.DEFAULT_BUDGET_USD) || 2,
  /** Default budget for bootstrapped admin accounts (USD). */
  defaultAdminBudgetUsd: Number(process.env.DEFAULT_ADMIN_BUDGET_USD) || 100,
  /** SQLite database path for users and stored API keys. */
  databasePath: process.env.DATABASE_PATH || pathJoin(process.cwd(), "..", "data", "platform.db"),
  /** Bundled PI extensions root (see repo `pi-extensions/`). */
  piExtensionsRoot: process.env.PI_EXTENSIONS_ROOT || defaultPiExtensionsRoot(),
};

function pathJoin(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}
