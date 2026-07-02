import { describe, expect, it } from "vitest";
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginGuardForTests,
} from "../login-guard.js";

describe("login-guard", () => {
  it("locks IP after repeated failures", () => {
    resetLoginGuardForTests();
    const ip = "203.0.113.10";
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    expect(checkLoginAllowed(ip).ok).toBe(false);
    recordLoginSuccess(ip);
    expect(checkLoginAllowed(ip).ok).toBe(true);
  });
});
