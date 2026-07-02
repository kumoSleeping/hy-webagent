import dns from "node:dns/promises";
import net from "node:net";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "ip6-localhost",
  "ip6-loopback",
]);

export interface SafeRemoteFetchOptions {
  timeoutMs: number;
  maxRedirects?: number;
}

export function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c, d] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b! >= 64 && b! <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a! >= 224 && a! <= 239) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (/^f[c-d][0-9a-f]{0,2}:/i.test(lower)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]{0,2}:/i.test(lower)) return true; // fe80::/10
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return isBlockedIPv4(mapped);
  }
  return false;
}

export function isBlockedHostAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) return isBlockedIPv4(address);
  if (kind === 6) return isBlockedIPv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local")) return true;
  if (lower.endsWith(".internal")) return true;
  return false;
}

/** Validate outbound URL before fetch — blocks private/reserved targets and unsafe schemes. */
export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not allowed");
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error("URL hostname required");
  }

  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  const literalKind = net.isIP(hostname);
  if (literalKind) {
    if (isBlockedHostAddress(hostname)) {
      throw new Error(`Blocked IP address: ${hostname}`);
    }
    return parsed;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS lookup failed: ${(err as Error).message}`);
  }

  if (records.length === 0) {
    throw new Error("DNS lookup returned no addresses");
  }

  for (const { address } of records) {
    if (isBlockedHostAddress(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to restricted address ${address}`);
    }
  }

  return parsed;
}

/** Fetch with SSRF checks on every redirect hop; redirects are not followed automatically. */
export async function safeRemoteFetch(
  rawUrl: string,
  options: SafeRemoteFetchOptions
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeRemoteUrl(currentUrl);

    const response = await fetch(currentUrl, {
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response missing Location header");
      }
      if (hop >= maxRedirects) {
        throw new Error("Too many redirects");
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}
