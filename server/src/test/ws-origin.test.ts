import { describe, expect, it } from "vitest";
import { isWebSocketOriginAllowed } from "../ws-origin.js";

describe("ws-origin", () => {
  it("allows configured browser origin", () => {
    expect(
      isWebSocketOriginAllowed({
        headers: { origin: "http://localhost:5173" },
      } as import("node:http").IncomingMessage)
    ).toBe(true);
  });

  it("rejects unknown origin by default", () => {
    expect(
      isWebSocketOriginAllowed({
        headers: { origin: "http://evil.example" },
      } as import("node:http").IncomingMessage)
    ).toBe(false);
  });
});
