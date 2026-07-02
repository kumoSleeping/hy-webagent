/** Machine-readable Admin API + CLI catalog for agents and operators. */

export interface AdminEndpointDoc {
  method: string;
  path: string;
  auth: "admin" | "admin session" | "none";
  description: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  example?: { curl?: string; cli?: string };
}

export interface AdminCliCommandDoc {
  command: string;
  description: string;
  example: string;
}

export interface AdminApiCatalog {
  version: string;
  baseUrl: string;
  auth: {
    header: string;
    sources: string[];
  };
  defaults: {
    userBudgetUsd: number;
    adminBudgetUsd: null;
    usageStorage: string;
    usersStorage: string;
  };
  endpoints: AdminEndpointDoc[];
  cli: {
    bin: string;
    npmScript: string;
    commands: AdminCliCommandDoc[];
  };
}

export function getAdminApiCatalog(baseUrl = "http://localhost:3001"): AdminApiCatalog {
  const key = "<ADMIN_API_KEY>";
  const authHeader = `Authorization: Bearer ${key}`;

  return {
    version: "1.0",
    baseUrl,
    auth: {
      header: "Authorization: Bearer <admin-api-key-or-session-or-ADMIN_KEY>",
      sources: [
        "Admin user API key (stored in platform.db after bootstrap)",
        "Admin sessionId after login",
        "Environment ADMIN_KEY (optional master key, not stored on disk)",
        "Admin AI session API: /api/platform/admin/* (Bearer sessionId)",
      ],
    },
    defaults: {
      userBudgetUsd: 2,
      adminBudgetUsd: null,
      usageStorage: "data/usage/{userId}/{YYYY-MM-DD}.json",
      usersStorage: "data/platform.db (SQLite)",
    },
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/help",
        auth: "none",
        description: "This catalog — no auth required",
      },
      {
        method: "POST",
        path: "/api/admin/users",
        auth: "admin",
        description: "Create user; returns plainKey once",
        body: {
          displayName: "required",
          username: "optional",
          role: "user | admin",
          budgetUsd: "number | null (admin default null=unlimited, user default 2)",
          modelTemplateId: "optional: full | budget-cn | null (default full)",
          apiKey: "optional; auto-generated if omitted",
        },
        example: {
          curl: `curl -s -X POST ${baseUrl}/api/admin/users -H "${authHeader}" -H "Content-Type: application/json" -d '{"displayName":"Alice","username":"alice"}'`,
          cli: "npm run admin -- users create --name Alice --username alice",
        },
      },
      {
        method: "GET",
        path: "/api/admin/users",
        auth: "admin",
        description: "List all users",
        example: { cli: "npm run admin -- users list" },
      },
      {
        method: "GET",
        path: "/api/admin/users/:userId",
        auth: "admin",
        description: "User detail + today usage",
        example: { cli: "npm run admin -- users show alice" },
      },
      {
        method: "PATCH",
        path: "/api/admin/users/:userId",
        auth: "admin",
        description: "Update user; set role=admin to promote (reloads admin-skills on active sessions)",
        body: { role: "admin | user", budgetUsd: "number | null", displayName: "string", modelTemplateId: "full | budget-cn | null" },
        example: {
          curl: `curl -s -X PATCH ${baseUrl}/api/admin/users/<userId> -H "${authHeader}" -H "Content-Type: application/json" -d '{"role":"admin"}'`,
          cli: "npm run admin -- users promote alice",
        },
      },
      {
        method: "POST",
        path: "/api/admin/users/:userId/add-budget",
        auth: "admin",
        description: "Top up user budget cap (incremental distribution)",
        body: { amountUsd: "positive number" },
        example: { cli: "npm run admin -- users add-budget alice 0.5" },
      },
      {
        method: "POST",
        path: "/api/admin/users/:userId/rotate-key",
        auth: "admin",
        description: "Rotate API key; returns new plainKey once",
        example: { cli: "npm run admin -- users rotate-key alice" },
      },
      {
        method: "DELETE",
        path: "/api/admin/users/:userId",
        auth: "admin",
        description: "Delete user (cannot delete last admin)",
      },
      {
        method: "GET",
        path: "/api/admin/usage",
        auth: "admin",
        description: "All users daily usage for a date",
        query: { date: "YYYY-MM-DD (default today UTC)" },
        example: { cli: "npm run admin -- usage today" },
      },
      {
        method: "GET",
        path: "/api/admin/usage/:userId",
        auth: "admin",
        description: "User usage range with per-model and bySource (chat/btw/subagent) breakdown",
        query: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" },
        example: { cli: "npm run admin -- usage user alice --from 2026-07-01 --to 2026-07-02" },
      },
      {
        method: "GET",
        path: "/api/admin/usage/:userId/daily",
        auth: "admin",
        description: "List dates with usage files for a user",
      },
      {
        method: "GET",
        path: "/api/platform/admin/usage",
        auth: "admin session",
        description: "Same as /api/admin/usage but Bearer sessionId from .pi/platform-admin.json",
        query: { date: "YYYY-MM-DD (default today UTC)" },
      },
      {
        method: "GET",
        path: "/api/platform/admin/usage/:userIdOrUsername",
        auth: "admin session",
        description: "Per-user usage range; path accepts username (alice) or userId; per-model in days[].models",
        query: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" },
        example: {
          curl: `curl -s -H "Authorization: Bearer <sessionId>" ${baseUrl}/api/platform/admin/usage/alice?from=2026-07-02&to=2026-07-02`,
        },
      },
      {
        method: "GET",
        path: "/api/platform/admin/usage/:userIdOrUsername/daily",
        auth: "admin session",
        description: "List dates with usage data for a user (by username or userId)",
      },
      {
        method: "GET",
        path: "/api/admin/model-templates",
        auth: "admin",
        description: "List model access templates (full, budget-cn, …)",
      },
      {
        method: "GET",
        path: "/api/platform/admin/model-templates",
        auth: "admin session",
        description: "Same template catalog for logged-in admin session",
      },
      {
        method: "GET",
        path: "/api/platform/admin/models",
        auth: "admin session",
        description: "All models with display names — use keys in model-filter",
      },
      {
        method: "PUT",
        path: "/api/platform/admin/users/:idOrUsername/model-filter",
        auth: "admin session",
        description: "Set or clear per-user model allowlist",
        body: { models: '["provider/modelId"] or null', allow: "[{provider,modelId}] or null" },
        example: {
          curl: `curl -s -X PUT ${baseUrl}/api/platform/admin/users/alice/model-filter -H "Authorization: Bearer <sessionId>" -H "Content-Type: application/json" -d '{"models":["deepseek/deepseek-v4-flash"]}'`,
        },
      },
      {
        method: "GET",
        path: "/api/admin/skills",
        auth: "admin",
        description: "List admin-skills/ documents injected for role=admin",
      },
    ],
    cli: {
      bin: "pi-admin",
      npmScript: "npm run admin -- <command>",
      commands: [
        { command: "help", description: "Show CLI + API catalog", example: "npm run admin -- help" },
        { command: "users list", description: "List users (local JSON or remote API)", example: "npm run admin -- users list" },
        {
          command: "users create --name <display> [--username u] [--admin] [--budget N] [--model-template id]",
          description: "Create user; prints plainKey",
          example: "npm run admin -- users create --name Alice --username alice --model-template budget-cn",
        },
        {
          command: "users promote <id|username>",
          description: "Promote to admin (unlimited budget + admin-skills)",
          example: "npm run admin -- users promote alice",
        },
        {
          command: "users add-budget <id|username> <amountUsd>",
          description: "Increment budget cap",
          example: "npm run admin -- users add-budget alice 0.5",
        },
        { command: "users show <id|username>", description: "User + today usage", example: "npm run admin -- users show admin" },
        { command: "users rotate-key <id|username>", description: "Rotate API key", example: "npm run admin -- users rotate-key alice" },
        { command: "usage today [--date YYYY-MM-DD]", description: "Site-wide daily usage", example: "npm run admin -- usage today" },
        {
          command: "usage user <id|username> [--from D] [--to D]",
          description: "Per-user usage",
          example: "npm run admin -- usage user alice",
        },
        { command: "bootstrap", description: "Create first admin if none exist; print API key once", example: "npm run admin -- bootstrap" },
      ],
    },
  };
}

export function formatCatalogText(catalog: AdminApiCatalog): string {
  const lines: string[] = [
    "HY-Webagent — Admin API & CLI",
    "",
    "Auth: Authorization: Bearer <admin-api-key>",
    "  Database: data/platform.db (users + stored_api_keys)",
    "  Admin AI API: /api/platform/admin/* (Bearer <sessionId> from .pi/platform-admin.json)",
    "",
    "Defaults:",
    `  user budget: $${catalog.defaults.userBudgetUsd}`,
    "  admin budget: unlimited (null)",
    "",
    "CLI (offline, no server required):",
    `  ${catalog.cli.npmScript}`,
    "",
  ];
  for (const c of catalog.cli.commands) {
    lines.push(`  ${c.command}`);
    lines.push(`    ${c.description}`);
    lines.push(`    e.g. ${c.example}`);
    lines.push("");
  }
  lines.push("HTTP API:");
  for (const e of catalog.endpoints) {
    lines.push(`  ${e.method} ${e.path} [${e.auth}]`);
    lines.push(`    ${e.description}`);
    if (e.example?.cli) lines.push(`    CLI: ${e.example.cli}`);
    if (e.example?.curl) lines.push(`    curl: ${e.example.curl}`);
    lines.push("");
  }
  lines.push(`Catalog JSON: GET ${catalog.baseUrl}/api/admin/help`);
  return lines.join("\n");
}
