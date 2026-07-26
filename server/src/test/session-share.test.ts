import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionShareRepository } from "../db/session-share-repository.js";

const SESSION_A = "019f1104-1cf9-7d93-a733-eb4e4f5be525";
const SESSION_B = "019f2205-2df0-7e84-b844-fc5f5g6cf636".replace(/[g-z]/g, "a");

let repo: SessionShareRepository;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "share-repo-"));
  repo = new SessionShareRepository(join(dir, "test.db"));
});

describe("SessionShareRepository", () => {
  it("resolves a freshly issued token to its grant", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    const share = repo.resolve(token);
    expect(share).not.toBeNull();
    expect(share?.piSessionId).toBe(SESSION_A);
    expect(share?.ownerUserId).toBe("alice");
  });

  it("issues unguessable, unique tokens", () => {
    const a = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" }).token;
    const b = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" }).token;
    expect(a).not.toBe(b);
    // 32 random bytes in base64url.
    expect(a.length).toBeGreaterThanOrEqual(42);
  });

  it("does not store the token in plaintext", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    // A database reader must not come away with usable share links.
    const rows = (repo as any).db.prepare("SELECT token_hash FROM session_shares").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an unknown token", () => {
    repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    expect(repo.resolve("not-a-real-token")).toBeNull();
    expect(repo.resolve("")).toBeNull();
  });

  it("rejects a revoked token", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    expect(repo.revokeAllForSession(SESSION_A, "alice")).toBe(1);
    expect(repo.resolve(token)).toBeNull();
  });

  it("only lets the owner revoke", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    expect(repo.revokeAllForSession(SESSION_A, "mallory")).toBe(0);
    expect(repo.resolve(token)).not.toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice", ttlMs: -1 });
    expect(repo.resolve(token)).toBeNull();
  });

  it("binds a token to exactly one session", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    const share = repo.resolve(token);
    // The caller compares this against the requested session; a token valid for
    // one session must never unlock another.
    expect(share?.piSessionId).toBe(SESSION_A);
    expect(share?.piSessionId).not.toBe(SESSION_B);
  });

  it("lists only live grants for a session", () => {
    repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    repo.create({ piSessionId: SESSION_A, ownerUserId: "alice", ttlMs: -1 });
    expect(repo.listForSession(SESSION_A)).toHaveLength(1);
  });

  it("counts views", () => {
    const { token } = repo.create({ piSessionId: SESSION_A, ownerUserId: "alice" });
    repo.recordView(token);
    repo.recordView(token);
    const [share] = repo.listForSession(SESSION_A);
    expect(share.viewCount).toBe(2);
    expect(share.lastViewedAt).toBeGreaterThan(0);
  });

  it("prunes revoked and expired grants", () => {
    repo.create({ piSessionId: SESSION_A, ownerUserId: "alice", ttlMs: -1 });
    expect(repo.prune(0)).toBe(1);
    expect(repo.listForSession(SESSION_A)).toHaveLength(0);
  });
});
