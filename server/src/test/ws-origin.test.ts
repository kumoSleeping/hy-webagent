import { afterEach, describe, expect, it } from "vitest";
import { expandAllowedOrigins, isOriginAllowed, isWebSocketOriginAllowed } from "../ws-origin.js";

describe("ws-origin", () => {
  afterEach(() => {
    delete process.env.CORS_ORIGIN;
    delete process.env.WS_ALLOW_NO_ORIGIN;
  });

  it("allows configured browser origin", () => {
    process.env.CORS_ORIGIN = "http://localhost:5173";
    expect(
      isWebSocketOriginAllowed({
        headers: { origin: "http://localhost:5173" },
      } as import("node:http").IncomingMessage)
    ).toBe(true);
  });

  it("allows http sibling when https is configured", () => {
    process.env.CORS_ORIGIN = "https://chat.kumo.ltd";
    expect(isOriginAllowed("http://chat.kumo.ltd")).toBe(true);
    expect(isOriginAllowed("https://chat.kumo.ltd")).toBe(true);
  });

  it("expands configured origins with scheme siblings", () => {
    const allowed = expandAllowedOrigins(["https://chat.kumo.ltd"]);
    expect(allowed.has("https://chat.kumo.ltd")).toBe(true);
    expect(allowed.has("http://chat.kumo.ltd")).toBe(true);
  });

  it("rejects unknown origin by default", () => {
    process.env.CORS_ORIGIN = "https://chat.kumo.ltd";
    expect(
      isWebSocketOriginAllowed({
        headers: { origin: "http://evil.example" },
      } as import("node:http").IncomingMessage)
    ).toBe(false);
  });
});
