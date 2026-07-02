import { describe, it, expect, vi, afterEach } from "vitest";
import { WELCOME_PHRASES, pickWelcomePhrase } from "./welcomePhrases";

describe("welcomePhrases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a non-empty phrase list", () => {
    expect(WELCOME_PHRASES.length).toBeGreaterThan(0);
  });

  it("picks a phrase from the maintained list", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    expect(WELCOME_PHRASES).toContain(pickWelcomePhrase());
  });
});
