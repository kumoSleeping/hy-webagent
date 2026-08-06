import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicSessionAccessRepository } from "../db/public-session-access-repository.js";

const SESSION = "019f1104-1cf9-7d93-a733-eb4e4f5be525";

let repo: PublicSessionAccessRepository;

beforeEach(() => {
  repo = new PublicSessionAccessRepository(join(mkdtempSync(join(tmpdir(), "public-session-")), "test.db"));
});

describe("PublicSessionAccessRepository", () => {
  it("does not expose a session until its owner enables ordinary-URL access", () => {
    expect(repo.resolve(SESSION)).toBeNull();

    const access = repo.enable(SESSION, "alice");

    expect(access.piSessionId).toBe(SESSION);
    expect(access.ownerUserId).toBe("alice");
    expect(repo.resolve(SESSION)).toEqual(access);
  });

  it("makes repeated enable commands idempotent", () => {
    const first = repo.enable(SESSION, "alice");
    const second = repo.enable(SESSION, "alice");

    expect(second).toEqual(first);
  });

  it("does not let another owner take over an enabled session", () => {
    repo.enable(SESSION, "alice");
    expect(() => repo.enable(SESSION, "mallory")).toThrow("belongs to another user");
  });

  it("removes ordinary-URL access only for its owner", () => {
    repo.enable(SESSION, "alice");

    expect(repo.disable(SESSION, "mallory")).toBe(false);
    expect(repo.resolve(SESSION)).not.toBeNull();
    expect(repo.disable(SESSION, "alice")).toBe(true);
    expect(repo.resolve(SESSION)).toBeNull();
  });
});
