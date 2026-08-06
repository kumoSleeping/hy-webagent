import { describe, expect, it } from "vitest";
import { isPublicSharedSessionUrl } from "../guest-view.js";

describe("public shared session URLs", () => {
  it("accepts a complete session UUID as an unauthenticated read-only share URL", () => {
    expect(isPublicSharedSessionUrl("019f1104-1cf9-7d93-a733-eb4e4f5be525")).toBe(true);
  });

  it("rejects partial ids and filesystem-shaped input before guest lookup", () => {
    expect(isPublicSharedSessionUrl("019f1104")).toBe(false);
    expect(isPublicSharedSessionUrl("../../sessions/anything")).toBe(false);
  });
});
