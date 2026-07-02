#!/usr/bin/env node
// End-to-end verification script for slash commands.
// Requires the server to be running and an admin key in data/admin-key.txt.
// Usage: ADMIN_KEY=xxx API_URL=http://localhost:3002 npx tsx src/test/verify-slash.ts

import fs from "node:fs/promises";

const API_URL = process.env.API_URL || "http://localhost:3002";
const ADMIN_KEY = process.env.ADMIN_KEY;

interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function apiCall<T>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) return { ok: false, error: data.error || text };
  return { ok: true, data: data as T };
}

function openWs(token: string, piSessionId: string): WebSocket {
  return new WebSocket(`${API_URL.replace("http", "ws")}/ws/chat?sessionId=${token}&piSessionId=${piSessionId}`);
}

function slash(ws: WebSocket, command: string, args: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ type: "slash:execute", payload: { command, args } }));
}

async function waitForSlash(ws: WebSocket, command: string, timeoutMs = 3000): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, message: "timeout" }), timeoutMs);
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data));
      if ((msg.type === "slash:result" || msg.type === "slash:error") && msg.payload?.command === command) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        resolve(msg.payload);
      }
    };
    ws.addEventListener("message", handler);
  });
}

async function main() {
  const adminKey = ADMIN_KEY || (await fs.readFile("../../data/admin-key.txt", "utf-8").catch(() => "")).trim();
  if (!adminKey) {
    console.error("Admin key required. Set ADMIN_KEY or ensure data/admin-key.txt exists.");
    process.exit(1);
  }

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // Login with the admin key (first user created by server)
  const loginRes = await apiCall<{ sessionId: string }>("POST", "/api/auth/login", { apiKey: adminKey });
  if (!loginRes.ok) {
    console.error("Failed to login:", loginRes.error);
    process.exit(1);
  }
  const sessionToken = loginRes.data!.sessionId;

  // Init workspace
  await apiCall("POST", "/api/workspace/init", undefined, sessionToken);

  // Create session A
  const createA = await apiCall<{ sessionId: string }>("POST", "/api/sessions/create", undefined, sessionToken);
  checks.push({ name: "Create session A", ok: createA.ok, detail: createA.error });
  const sessionA = createA.data?.sessionId;
  if (!sessionA) process.exit(1);

  // Get available models
  const modelsRes = await apiCall<{ models: unknown[] }>("GET", "/api/models", undefined, sessionToken);
  checks.push({ name: "Get /api/models", ok: modelsRes.ok, detail: modelsRes.error });

  // Get dynamic slash commands
  const slashCmdsRes = await apiCall<{ system: { id: string; kind: string }[]; dynamic: unknown[] }>("GET", "/api/slash/commands", undefined, sessionToken);
  const exportCmd = slashCmdsRes.data?.system.find((c) => c.id === "export");
  checks.push({ name: "Get /api/slash/commands", ok: slashCmdsRes.ok, detail: slashCmdsRes.error });
  checks.push({ name: "/export command advertised as panel", ok: exportCmd?.kind === "panel", detail: exportCmd?.kind });

  // Get session tree
  const treeRes = await apiCall<{ tree: unknown[]; currentEntryId?: string }>("GET", `/api/sessions/${sessionA}/tree`, undefined, sessionToken);
  checks.push({ name: "Get session tree", ok: treeRes.ok, detail: treeRes.error });

  // Open WebSocket on session A
  const wsA = openWs(sessionToken, sessionA);
  await new Promise<void>((resolve, reject) => {
    wsA.onopen = () => resolve();
    wsA.onerror = reject;
  });

  // 1. /name
  slash(wsA, "session.name", { name: "verified" });
  const nameRes = await waitForSlash(wsA, "session.name");
  checks.push({ name: "/name renames session", ok: nameRes.ok === true, detail: nameRes.message });

  // 2. /stats
  slash(wsA, "session.stats");
  const statsRes = await waitForSlash(wsA, "session.stats");
  checks.push({ name: "/stats returns stats", ok: statsRes.ok === true && (statsRes.data as any)?.sessionId, detail: statsRes.message });

  // 3. /copy
  slash(wsA, "session.copy");
  const copyRes = await waitForSlash(wsA, "session.copy");
  checks.push({ name: "/copy returns last assistant", ok: copyRes.ok === true, detail: copyRes.message });

  // 4. /compact on empty session
  slash(wsA, "session.compact");
  const compactRes = await waitForSlash(wsA, "session.compact");
  const compactExpected = compactRes.ok === true || (compactRes.message?.includes("Nothing to compact") ?? false);
  checks.push({ name: "/compact empty session handled", ok: compactExpected, detail: compactRes.message });

  // 5. /tree
  slash(wsA, "session.tree");
  const treeCmdRes = await waitForSlash(wsA, "session.tree");
  checks.push({ name: "/tree returns tree", ok: treeCmdRes.ok === true && Array.isArray((treeCmdRes.data as any)?.tree), detail: treeCmdRes.message });

  // 6. /settings
  slash(wsA, "settings.set", { key: "thinkingLevel", value: "low" });
  const settingsRes = await waitForSlash(wsA, "settings.set");
  checks.push({ name: "/settings changes thinking level", ok: settingsRes.ok === true, detail: settingsRes.message });

  // 7. /model switch to first available model
  const firstModel = (modelsRes.data?.models as any[])?.[0] as { provider?: string; id?: string } | undefined;
  let modelSwitched = false;
  if (firstModel?.provider && firstModel?.id) {
    slash(wsA, "model.set", { provider: firstModel.provider, modelId: firstModel.id });
    const modelRes = await waitForSlash(wsA, "model.set");
    modelSwitched = modelRes.ok === true;
    checks.push({ name: "/model switches to available model", ok: modelSwitched, detail: modelRes.message });
  } else {
    checks.push({ name: "/model switches to available model", ok: false, detail: "no models available" });
  }

  // 8. /exportJsonl
  slash(wsA, "session.exportJsonl");
  const exportRes = await waitForSlash(wsA, "session.exportJsonl");
  checks.push({ name: "/exportJsonl returns file", ok: exportRes.ok === true && typeof (exportRes.data as any)?.filePath === "string", detail: exportRes.message });
  const exportedFile = (exportRes.data as any)?.filePath as string | undefined;

  // 9. /importJsonl roundtrip
  if (exportedFile) {
    slash(wsA, "session.importJsonl", { sourcePath: exportedFile });
    const importRes = await waitForSlash(wsA, "session.importJsonl");
    checks.push({ name: "/importJsonl loads exported file", ok: importRes.ok === true, detail: importRes.message });
  } else {
    checks.push({ name: "/importJsonl loads exported file", ok: false, detail: "no export file" });
  }

  // 10. /new creates a usable new session and WebSocket reconnect works
  slash(wsA, "session.new");
  const newRes = await waitForSlash(wsA, "session.new");
  const sessionB = (newRes.data as any)?.sessionId as string | undefined;
  checks.push({
    name: "/new returns new sessionId",
    ok: newRes.ok === true && !!sessionB && sessionB !== sessionA,
    detail: newRes.message,
  });

  wsA.close();

  if (sessionB) {
    const wsB = openWs(sessionToken, sessionB);
    await new Promise<void>((resolve, reject) => {
      wsB.onopen = () => resolve();
      wsB.onerror = reject;
    });
    slash(wsB, "session.name", { name: "session-b" });
    const nameBRes = await waitForSlash(wsB, "session.name");
    checks.push({ name: "/new session is usable", ok: nameBRes.ok === true, detail: nameBRes.message });

    // Send a real prompt to create a user message entry for forking.
    // If the configured model has an API key, this will also produce an assistant reply.
    if (firstModel?.provider && firstModel?.id) {
      slash(wsB, "model.set", { provider: firstModel.provider, modelId: firstModel.id });
      await waitForSlash(wsB, "model.set", 5000);
      wsB.send(JSON.stringify({ type: "chat:prompt", payload: { text: "Hello" } }));
      await new Promise<void>((resolve) => {
        const handler = (event: MessageEvent) => {
          const msg = JSON.parse(String(event.data));
          // no-op: waiting for turn to complete
          if (msg.type === "chat:agent_end" || msg.type === "chat:error") {
            wsB.removeEventListener("message", handler);
            resolve();
          }
        };
        wsB.addEventListener("message", handler);
        setTimeout(() => {
          wsB.removeEventListener("message", handler);
          resolve();
        }, 15000);
      });
    }

    // 11. /fork from the new session (need a valid user message entry)
    slash(wsB, "session.tree");
    const treeBRes = await waitForSlash(wsB, "session.tree");
    const treeB = (treeBRes.data as any)?.tree as any[] | undefined;
    // find the last user message entry in the tree to use as fork target
    const findUserEntry = (nodes: any[]): string | undefined => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node.entry?.type === "message" && node.entry?.message?.role === "user") return node.entry.id;
        const child = findUserEntry(node.children || []);
        if (child) return child;
      }
      return undefined;
    };
    const userEntryB = treeB ? findUserEntry(treeB) : undefined;
    if (userEntryB) {
      slash(wsB, "session.fork", { entryId: userEntryB });
      const forkRes = await waitForSlash(wsB, "session.fork");
      const sessionFork = (forkRes.data as any)?.sessionId as string | undefined;
      checks.push({
        name: "/fork returns new sessionId",
        ok: forkRes.ok === true && !!sessionFork && sessionFork !== sessionB,
        detail: forkRes.message,
      });
    } else {
      checks.push({ name: "/fork returns new sessionId", ok: false, detail: "no user message entry" });
    }

    // 12. /resume back to session A
    slash(wsB, "session.resume", { sessionId: sessionA });
    const resumeRes = await waitForSlash(wsB, "session.resume");
    checks.push({ name: "/resume switches session", ok: resumeRes.ok === true, detail: resumeRes.message });

    wsB.close();
  } else {
    checks.push({ name: "/new session is usable", ok: false, detail: "no session B" });
    checks.push({ name: "/fork returns new sessionId", ok: false, detail: "no session B" });
    checks.push({ name: "/resume switches session", ok: false, detail: "no session B" });
  }

  // 13. /scoped-models route
  const wsScoped = openWs(sessionToken, sessionA);
  await new Promise<void>((resolve, reject) => {
    wsScoped.onopen = () => resolve();
    wsScoped.onerror = reject;
  });
  slash(wsScoped, "model.setScoped", { models: [] });
  const scopedRes = await waitForSlash(wsScoped, "model.setScoped");
  checks.push({ name: "/scoped-models route reachable", ok: scopedRes.ok === true, detail: scopedRes.message });
  wsScoped.close();

  // Report
  console.log("\n=== Slash Command Verification ===\n");
  let passed = 0;
  for (const check of checks) {
    const status = check.ok ? "✅" : "❌";
    console.log(`${status} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
    if (check.ok) passed++;
  }
  console.log(`\n${passed}/${checks.length} checks passed`);

  if (passed < checks.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
