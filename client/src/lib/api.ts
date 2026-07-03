let sessionId: string | null = null;

export function setSessionId(id: string | null) {
  sessionId = id;
}

function sessionIdFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )pi-session-id=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Force download URLs onto the current site origin (ignores localhost/dev URLs from model output). */
export function resolveSameOriginApiPath(apiPath: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://local";
  const url = new URL(apiPath, origin);
  return `${origin}${url.pathname}${url.search}`;
}

function authSessionId(): string | null {
  return sessionId ?? sessionIdFromCookie();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (sessionId) {
    headers["Authorization"] = `Bearer ${sessionId}`;
  }
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  // Handle empty responses (e.g. 204 No Content)
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text);
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    body: body ? JSON.stringify(body) : undefined,
  });
}

function filenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8 = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const ascii = /filename="([^"]+)"/i.exec(header);
  return ascii?.[1];
}

/** Download a workspace file via `/api/files/download` with session auth. */
export async function downloadAuthenticatedFile(apiPath: string): Promise<void> {
  const resolved = resolveSameOriginApiPath(apiPath);
  const token = authSessionId();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(resolved, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message = err.error || `HTTP ${res.status}`;
    const { useNotificationStore } = await import("../stores/notificationStore.js");
    useNotificationStore.getState().notify(`下载失败：${message}`, "info");
    throw new Error(message);
  }

  const blob = await res.blob();
  const name = filenameFromContentDisposition(res.headers.get("Content-Disposition")) || "download";
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
