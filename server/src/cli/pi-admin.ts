#!/usr/bin/env node
/**
 * pi-admin — offline-first CLI for user management and usage stats.
 * Works directly on data/platform.db without a running server.
 * Pass --remote to call the HTTP Admin API instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthSystem, generateApiKey } from "../auth.js";
import { UsageRecorder } from "../usage/recorder.js";
import { getAdminApiCatalog, formatCatalogText } from "../admin/catalog.js";
import { config } from "../config.js";
import { printFirstAdminKeyNotice } from "../admin-key.js";
import { openUserRepository } from "../db/user-repository.js";

const REPO_DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
const REPO_DB = path.join(REPO_DATA, "platform.db");

type Json = Record<string, unknown>;

interface GlobalOpts {
  remote: boolean;
  baseUrl: string;
  key: string;
  json: boolean;
}

function readStoredAdminKeyFromDb(): string {
  try {
    const repo = openUserRepository(REPO_DB);
    try {
      for (const user of repo.findAll()) {
        if (user.role !== "admin") continue;
        const key = repo.getStoredApiKey(user.userId);
        if (key) return key;
      }
    } finally {
      repo.close();
    }
  } catch {
    /* db not initialized yet */
  }
  return "";
}

function parseArgs(argv: string[]): { cmd: string[]; opts: GlobalOpts } {
  const opts: GlobalOpts = {
    remote: argv.includes("--remote"),
    baseUrl: process.env.PI_ADMIN_URL ?? `http://localhost:${config.port}`,
    key: process.env.PI_ADMIN_KEY ?? process.env.ADMIN_KEY ?? "",
    json: argv.includes("--json"),
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--remote") continue;
    if (a === "--json") continue;
    if (a === "--url" && argv[i + 1]) {
      opts.baseUrl = argv[++i]!;
      opts.remote = true;
      continue;
    }
    if (a === "--key" && argv[i + 1]) {
      opts.key = argv[++i]!;
      continue;
    }
    rest.push(a);
  }

  if (!opts.key) {
    opts.key = readStoredAdminKeyFromDb();
  }

  if (!opts.key) {
    const keyFile = path.join(REPO_DATA, "admin-key.txt");
    try {
      opts.key = fs.readFileSync(keyFile, "utf-8").trim();
    } catch { /* no legacy key file */ }
  }

  return { cmd: rest, opts };
}

function flagValue(cmd: string[], flag: string): string | undefined {
  const i = cmd.indexOf(flag);
  if (i >= 0 && cmd[i + 1]) return cmd[i + 1];
  return undefined;
}

function hasFlag(cmd: string[], flag: string): boolean {
  return cmd.includes(flag);
}

function stripFlags(cmd: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cmd.length; i++) {
    const a = cmd[i]!;
    if (a.startsWith("--")) {
      if (["--name", "--username", "--budget", "--from", "--to", "--date", "--model-template"].includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function output(opts: GlobalOpts, data: unknown, text?: string): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (text) {
    console.log(text);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function apiFetch(opts: GlobalOpts, method: string, apiPath: string, body?: unknown): Promise<Json> {
  if (!opts.key) fail("Admin key required: set PI_ADMIN_KEY, pass --key, or bootstrap admin (stored in platform.db)");
  const res = await fetch(`${opts.baseUrl}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${opts.key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Json = {};
  try {
    data = JSON.parse(text) as Json;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    fail((data.error as string) || `HTTP ${res.status}: ${text}`);
  }
  return data;
}

function localAuth(): AuthSystem {
  return new AuthSystem({ databasePath: REPO_DB });
}

function localUsage(): UsageRecorder {
  return new UsageRecorder(path.join(REPO_DATA, "usage"));
}

function resolveUser(auth: AuthSystem, idOrUsername: string) {
  const byId = auth.getUser(idOrUsername);
  if (byId) return byId;
  const byName = auth.findUserByUsername(idOrUsername);
  if (byName) return byName;
  fail(`User not found: ${idOrUsername}`);
}

async function cmdHelp(opts: GlobalOpts): Promise<void> {
  if (opts.remote) {
    const catalog = (await fetch(`${opts.baseUrl}/api/admin/help`).then((r) => r.json())) as ReturnType<
      typeof getAdminApiCatalog
    >;
    output(opts, catalog, opts.json ? undefined : formatCatalogText(catalog));
    return;
  }
  const catalog = getAdminApiCatalog(opts.baseUrl);
  output(opts, catalog, opts.json ? undefined : formatCatalogText(catalog));
}

async function cmdBootstrap(opts: GlobalOpts): Promise<void> {
  if (opts.remote) fail("bootstrap is local-only; run without --remote");
  const auth = localAuth();
  const users = auth.getAllUsers();
  if (users.some((u) => u.role === "admin")) {
    output(
      opts,
      { ok: true, admins: users.filter((u) => u.role === "admin") },
      "Admin user(s) already exist. Use an existing admin API key (PI_ADMIN_KEY / --key) or rotate-key if you lost it."
    );
    return;
  }
  const bootstrapKey = generateApiKey();
  const { user, plainKey } = await auth.createUser(bootstrapKey, "Admin", {
    role: "admin",
    username: "admin",
    budgetUsd: null,
  });
  fs.mkdirSync(REPO_DATA, { recursive: true });
  if (!opts.json) printFirstAdminKeyNotice(plainKey);
  output(
    opts,
    { userId: user.userId, plainKey, note: "Save plainKey now — not written to disk." },
    opts.json ? undefined : `Created admin user ${user.displayName}. API key printed above (not stored on disk).`
  );
}

async function cmdUsersList(opts: GlobalOpts): Promise<void> {
  if (opts.remote) {
    const data = await apiFetch(opts, "GET", "/api/admin/users");
    output(opts, data);
    return;
  }
  const users = localAuth().getAllUsers();
  output(opts, { users });
}

async function cmdUsersCreate(opts: GlobalOpts, cmd: string[]): Promise<void> {
  const name = flagValue(cmd, "--name");
  if (!name) fail("users create requires --name <displayName>");
  const username = flagValue(cmd, "--username");
  const admin = hasFlag(cmd, "--admin");
  const budgetRaw = flagValue(cmd, "--budget");
  const modelTemplate = flagValue(cmd, "--model-template");
  const budgetUsd =
    budgetRaw !== undefined ? (budgetRaw === "null" ? null : Number(budgetRaw)) : admin ? null : undefined;

  const body = {
    displayName: name,
    username,
    role: admin ? "admin" : "user",
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(modelTemplate !== undefined ? { modelTemplateId: modelTemplate === "full" ? null : modelTemplate } : {}),
  };

  if (opts.remote) {
    const data = await apiFetch(opts, "POST", "/api/admin/users", body);
    output(
      opts,
      data,
      opts.json
        ? undefined
        : `Created user ${data.displayName}\nplainKey (save now): ${data.plainKey}`
    );
    return;
  }

  const auth = localAuth();
  const { user, plainKey } = await auth.createUser(undefined, name, {
    username,
    role: admin ? "admin" : "user",
    budgetUsd: budgetUsd ?? undefined,
    modelTemplateId:
      modelTemplate !== undefined ? (modelTemplate === "full" ? null : modelTemplate) : undefined,
  });
  output(
    opts,
    { user, plainKey },
    opts.json ? undefined : `Created ${user.displayName} (${user.role})\nplainKey: ${plainKey}`
  );
}

async function cmdUsersShow(opts: GlobalOpts, idOrUsername: string): Promise<void> {
  if (opts.remote) {
    const users = (await apiFetch(opts, "GET", "/api/admin/users")) as { users: Array<{ userId: string; username: string }> };
    let userId = idOrUsername;
    const match = users.users.find(
      (u) => u.userId === idOrUsername || u.username?.toLowerCase() === idOrUsername.toLowerCase()
    );
    if (match) userId = match.userId;
    const data = await apiFetch(opts, "GET", `/api/admin/users/${userId}`);
    output(opts, data);
    return;
  }
  const auth = localAuth();
  const user = resolveUser(auth, idOrUsername);
  const usage = localUsage().getDaily(user.userId, utcToday());
  const { apiKeyHash: _, ...publicUser } = user;
  output(opts, { user: publicUser, usageToday: usage });
}

async function cmdUsersPromote(opts: GlobalOpts, idOrUsername: string): Promise<void> {
  if (opts.remote) {
    const list = (await apiFetch(opts, "GET", "/api/admin/users")) as { users: Array<{ userId: string; username: string }> };
    const match = list.users.find(
      (u) => u.userId === idOrUsername || u.username?.toLowerCase() === idOrUsername.toLowerCase()
    );
    if (!match) fail(`User not found: ${idOrUsername}`);
    const data = await apiFetch(opts, "PATCH", `/api/admin/users/${match.userId}`, { role: "admin" });
    output(opts, data, opts.json ? undefined : `Promoted ${match.username} to admin. ${data.note ?? ""}`);
    return;
  }
  const auth = localAuth();
  const user = resolveUser(auth, idOrUsername);
  const updated = auth.updateUser(user.userId, { role: "admin" });
  output(
    opts,
    { user: updated },
    opts.json ? undefined : `Promoted ${updated.displayName} to admin (budget unlimited). Re-login or /reload for admin-skills.`
  );
}

async function cmdUsersAddBudget(opts: GlobalOpts, idOrUsername: string, amountStr: string): Promise<void> {
  const amountUsd = Number(amountStr);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) fail("amountUsd must be a positive number");

  if (opts.remote) {
    const list = (await apiFetch(opts, "GET", "/api/admin/users")) as { users: Array<{ userId: string; username: string }> };
    const match = list.users.find(
      (u) => u.userId === idOrUsername || u.username?.toLowerCase() === idOrUsername.toLowerCase()
    );
    if (!match) fail(`User not found: ${idOrUsername}`);
    const data = await apiFetch(opts, "POST", `/api/admin/users/${match.userId}/add-budget`, { amountUsd });
    output(opts, data);
    return;
  }
  const auth = localAuth();
  const user = resolveUser(auth, idOrUsername);
  const updated = auth.addBudget(user.userId, amountUsd);
  output(opts, { user: updated, addedUsd: amountUsd }, opts.json ? undefined : `Added $${amountUsd} to ${updated.displayName}. New cap: $${updated.budgetUsd}`);
}

async function cmdUsersRotateKey(opts: GlobalOpts, idOrUsername: string): Promise<void> {
  if (opts.remote) {
    const list = (await apiFetch(opts, "GET", "/api/admin/users")) as { users: Array<{ userId: string; username: string }> };
    const match = list.users.find(
      (u) => u.userId === idOrUsername || u.username?.toLowerCase() === idOrUsername.toLowerCase()
    );
    if (!match) fail(`User not found: ${idOrUsername}`);
    const data = await apiFetch(opts, "POST", `/api/admin/users/${match.userId}/rotate-key`, {});
    output(opts, data, opts.json ? undefined : `New plainKey: ${data.plainKey}`);
    return;
  }
  const auth = localAuth();
  const user = resolveUser(auth, idOrUsername);
  const result = await auth.rotateApiKey(user.userId);
  output(opts, result, opts.json ? undefined : `New plainKey for ${user.displayName}: ${result.plainKey}`);
}

async function cmdUsageToday(opts: GlobalOpts, cmd: string[]): Promise<void> {
  const date = flagValue(cmd, "--date") ?? utcToday();
  if (opts.remote) {
    const data = await apiFetch(opts, "GET", `/api/admin/usage?date=${encodeURIComponent(date)}`);
    output(opts, data);
    return;
  }
  const usage = localUsage().getAllUsersDaily(date);
  output(opts, { date, users: usage });
}

async function cmdUsageUser(opts: GlobalOpts, idOrUsername: string, cmd: string[]): Promise<void> {
  const from = flagValue(cmd, "--from") ?? utcToday();
  const to = flagValue(cmd, "--to") ?? from;

  if (opts.remote) {
    const list = (await apiFetch(opts, "GET", "/api/admin/users")) as { users: Array<{ userId: string; username: string }> };
    const match = list.users.find(
      (u) => u.userId === idOrUsername || u.username?.toLowerCase() === idOrUsername.toLowerCase()
    );
    if (!match) fail(`User not found: ${idOrUsername}`);
    const data = await apiFetch(
      opts,
      "GET",
      `/api/admin/usage/${match.userId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    output(opts, data);
    return;
  }
  const auth = localAuth();
  const user = resolveUser(auth, idOrUsername);
  const days = localUsage().getRange(user.userId, from, to);
  output(opts, { userId: user.userId, displayName: user.displayName, from, to, days });
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const positional = stripFlags(cmd);

  if (positional.length === 0 || positional[0] === "help" || positional.includes("--help") || positional.includes("-h")) {
    await cmdHelp(opts);
    return;
  }

  const [group, sub, ...rest] = positional;

  if (group === "bootstrap") {
    await cmdBootstrap(opts);
    return;
  }

  if (group === "users") {
    switch (sub) {
      case "list":
        await cmdUsersList(opts);
        return;
      case "create":
        await cmdUsersCreate(opts, cmd);
        return;
      case "show":
        if (!rest[0]) fail("users show <id|username>");
        await cmdUsersShow(opts, rest[0]);
        return;
      case "promote":
        if (!rest[0]) fail("users promote <id|username>");
        await cmdUsersPromote(opts, rest[0]);
        return;
      case "add-budget":
        if (!rest[0] || !rest[1]) fail("users add-budget <id|username> <amountUsd>");
        await cmdUsersAddBudget(opts, rest[0], rest[1]);
        return;
      case "rotate-key":
        if (!rest[0]) fail("users rotate-key <id|username>");
        await cmdUsersRotateKey(opts, rest[0]);
        return;
      default:
        fail(`Unknown users subcommand: ${sub ?? "(none)"}. Run: npm run admin -- help`);
    }
  }

  if (group === "usage") {
    if (sub === "today") {
      await cmdUsageToday(opts, cmd);
      return;
    }
    if (sub === "user") {
      if (!rest[0]) fail("usage user <id|username> [--from] [--to]");
      await cmdUsageUser(opts, rest[0], cmd);
      return;
    }
    fail(`Unknown usage subcommand: ${sub ?? "(none)"}`);
  }

  fail(`Unknown command: ${group}. Run: npm run admin -- help`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
