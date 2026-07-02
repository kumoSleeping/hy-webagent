// ============================================================
// PI Web Platform — Chat Test
// ============================================================
// Usage: cd server && npx tsx src/test-chat.ts
// ============================================================

import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("test-chat");
const URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const PROMPT = "Say hello in one sentence.";
const WS_URL = URL.replace("http://", "ws://").replace("https://", "wss://");

// ── helpers ──────────────────────────────────────────

const results: { name: string; ok: boolean; ms: number; detail?: string }[] = [];
function R(name: string, ok: boolean, start: number, detail?: string) {
  const ms = Date.now() - start;
  results.push({ name, ok, ms, detail });
  console.log(`${ok ? "✅" : "❌"} ${name} (${ms}ms)${detail ? " — " + detail : ""}`);
}

async function http(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  let body: any;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

// ── main ─────────────────────────────────────────────

async function main() {
  console.log("\n🧪 PI Chat Test\n");

  // 1. health
  let t = Date.now();
  try {
    const { status, body } = await http(`${URL}/health`);
    if (status === 200 && body?.ok) R("health", true, t);
    else throw new Error(`status=${status}`);
  } catch (e: any) {
    R("health", false, t, e.message);
    return summary();
  }

  // 2. api key
  let apiKey = process.env.API_KEY;
  if (!apiKey) {
    const p = path.join(process.cwd(), "..", "data", "admin-key.txt");
    if (fs.existsSync(p)) apiKey = fs.readFileSync(p, "utf-8").trim();
  }
  if (!apiKey) { console.log("❌ No API key\n"); return summary(); }

  // 3. login
  t = Date.now();
  let sessionId: string;
  try {
    const { status, body } = await http(`${URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (status !== 200 || !body.sessionId) throw new Error(body.error);
    sessionId = body.sessionId;
    R("login", true, t);
  } catch (e: any) {
    R("login", false, t, e.message);
    return summary();
  }

  // 4. init workspace (creates PI session)
  t = Date.now();
  try {
    const { status } = await http(`${URL}/api/workspace/init`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    if (status !== 200) throw new Error(`status=${status}`);
    R("workspace init", true, t);
  } catch (e: any) {
    R("workspace init", false, t, e.message);
    return summary();
  }

  // 5. connect WS
  t = Date.now();
  const ws = await new Promise<WebSocket | null>(resolve => {
    const timer = setTimeout(() => { R("ws connect", false, t, "timeout"); resolve(null); }, 10_000);
    const s = new WebSocket(`${WS_URL}/ws/chat?sessionId=${sessionId}`);
    s.on("open", () => { clearTimeout(timer); R("ws connect", true, t); resolve(s); });
    s.on("error", (e) => { clearTimeout(timer); R("ws connect", false, t, e.message); resolve(null); });
  });
  if (!ws) return summary();

  // 6. abort any ongoing turn, then send prompt
  ws.send(JSON.stringify({ type: "chat:abort" }));
  await new Promise(r => setTimeout(r, 300));

  t = Date.now();
  let text = "";
  let tokens = 0;
  let errors: string[] = [];
  let ended = false;

  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { if (!ended) { ended = true; resolve(); } }, 120_000);

    ws.on("message", (raw: any) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === "chat:text_delta") text += msg.payload?.delta || "";
      if (msg.type === "chat:error") errors.push(msg.payload?.message || "?");
      if (msg.type === "token:update") tokens = msg.payload?.totalUsed || 0;

      if (msg.type === "chat:agent_end" && !ended) {
        setTimeout(() => { if (!ended) { ended = true; clearTimeout(timer); resolve(); } }, 500);
      }
    });

    log.info(`→ "${PROMPT}"`);
    ws.send(JSON.stringify({ type: "chat:prompt", payload: { text: PROMPT } }));
  });

  ws.close();

  if (text || !ended) {
    R("prompt → reply", text.length > 0 && errors.length === 0, t,
      `${text.length} chars, tokens=${tokens}, errs=${errors.length}`);
    if (text) console.log(`   🤖 ${text.slice(0, 200)}`);
    if (errors.length) console.log(`   ⚠️  ${errors.join("; ")}`);
  } else {
    R("prompt → reply", false, t, "no response");
  }

  summary();
}

function summary() {
  console.log("\n───────────────────────────");
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}`);
  const ok = results.filter(r => r.ok).length;
  console.log(`  ${ok}/${results.length} passed\n`);
}

main().catch(e => { console.error("crash:", e); process.exit(1); });
