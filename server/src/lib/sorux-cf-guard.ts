/**
 * Process-level SoruxGPT Cloudflare guard.
 *
 * PI talks to Sorux via the OpenAI SDK, which captures `fetch` per client.
 * Extension-time wrapping is too late / easy to miss, so we install this at
 * server boot and always route *.soruxgpt.com through `curl -4` (Node's TLS
 * fingerprint is intermittently CF-blocked from the JP host).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, watchFile, unwatchFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createLogger } from "../logger.js";

const log = createLogger("sorux-cf-guard");
const SORUX_HOST_RE = /(?:^|\.)soruxgpt\.com(?::\d+)?$/i;
const SKIP_REQ_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-connection",
  "expect",
  "accept-encoding",
]);

type GlobalFetch = typeof globalThis & {
  fetch: typeof fetch;
  __soruxCfGuardWrapped?: boolean;
  __soruxCfGuardMode?: "curl-first";
};

function isSoruxUrl(url: string): boolean {
  try {
    return SORUX_HOST_RE.test(new URL(url).hostname);
  } catch {
    return /soruxgpt\.com/i.test(url);
  }
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function bodyToString(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return await body.text();
  return await new Response(body as BodyInit).text();
}

function parseCurlHeaders(raw: string): { status: number; headers: Headers } {
  const blocks = raw.split(/\r?\n\r?\n/).filter((b) => b.trim());
  const block = blocks[blocks.length - 1] || raw;
  const lines = block.split(/\r?\n/).filter(Boolean);
  const statusLine = lines[0] || "HTTP/1.1 500";
  const match = statusLine.match(/HTTP\/\S+\s+(\d+)/i);
  const status = match ? Number(match[1]) : 500;
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers.append(key, value);
  }
  return { status, headers };
}

async function waitForHeaderFile(path: string, timeoutMs = 30_000): Promise<string> {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const check = () => {
      try {
        if (existsSync(path)) {
          const raw = readFileSync(path, "utf8");
          // curl -D writes the status line first; wait for the blank line that
          // ends the header block so we don't parse a partial write.
          if (/\r?\n\r?\n/.test(raw)) {
            cleanup();
            resolve(raw);
            return;
          }
        }
      } catch {
        // keep waiting
      }
      if (Date.now() - started > timeoutMs) {
        cleanup();
        reject(new Error(`curl headers timeout: ${path}`));
      }
    };
    const cleanup = () => {
      clearInterval(timer);
      try {
        unwatchFile(path);
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(check, 20);
    try {
      watchFile(path, { interval: 20 }, check);
    } catch {
      /* interval poll is enough */
    }
    check();
  });
}

async function fetchViaCurl(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json, text/event-stream, */*");
  }

  const hdrPath = join(tmpdir(), `sorux-cf-${randomBytes(8).toString("hex")}.hdr`);
  // HTTP/1.1 keeps -D header dumps simple; -N disables buffering for SSE.
  const args = [
    "-4",
    "-sS",
    "-N",
    "--http1.1",
    "--max-time",
    "900",
    "-X",
    method,
    "-D",
    hdrPath,
    "-o",
    "-",
    url,
  ];
  for (const [key, value] of headers.entries()) {
    if (SKIP_REQ_HEADERS.has(key.toLowerCase())) continue;
    args.push("-H", `${key}: ${value}`);
  }

  const bodyText = await bodyToString(init?.body ?? null);
  if (bodyText != null) {
    args.push("--data-binary", "@-");
  }

  const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
  if (bodyText != null) {
    child.stdin.write(bodyText);
  }
  child.stdin.end();

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const headerRaw = await waitForHeaderFile(hdrPath);
    const { status, headers: outHeaders } = parseCurlHeaders(headerRaw);
    const webStream = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    child.on("close", (code) => {
      try {
        unlinkSync(hdrPath);
      } catch {
        /* ignore */
      }
      if (code && code !== 0 && status >= 200 && status < 400) {
        log.warn("curl exited non-zero after headers", { code, status, stderr: stderr.slice(0, 200) });
      }
    });
    return new Response(webStream, {
      status,
      headers: outHeaders,
      statusText: stderr.trim() || undefined,
    });
  } catch (error) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(hdrPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/** Install once at process boot. Safe to call repeatedly. */
export function installSoruxCfGuard(): void {
  const g = globalThis as GlobalFetch;
  if (g.__soruxCfGuardWrapped && g.__soruxCfGuardMode === "curl-first") return;

  const previous = g.fetch.bind(g);
  g.__soruxCfGuardWrapped = true;
  g.__soruxCfGuardMode = "curl-first";

  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    if (!isSoruxUrl(url)) {
      return previous(input, init);
    }

    const bodyText = await bodyToString(
      init?.body ?? (input instanceof Request ? input.body : null)
    );
    const baseInit: RequestInit = {
      ...init,
      method: init?.method ?? (input instanceof Request ? input.method : undefined),
      headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
    };
    if (bodyText != null) baseInit.body = bodyText;
    // Avoid undici duplex requirements after materializing the body.
    delete (baseInit as { duplex?: string }).duplex;

    try {
      const response = await fetchViaCurl(url, baseInit);
      if (response.status === 403 || response.status === 503) {
        log.warn("sorux curl returned block status", {
          status: response.status,
          url: url.slice(0, 96),
        });
      }
      return response;
    } catch (error) {
      log.warn("sorux curl failed; falling back to node fetch", {
        err: error instanceof Error ? error.message : String(error),
        url: url.slice(0, 96),
      });
      return previous(url, baseInit);
    }
  };

  log.info("installed curl-first fetch guard for *.soruxgpt.com");
}
