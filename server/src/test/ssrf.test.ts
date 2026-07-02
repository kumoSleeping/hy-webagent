import { describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import {
  assertSafeRemoteUrl,
  isBlockedHostAddress,
  isBlockedIPv4,
  isBlockedIPv6,
} from "../ssrf.js";

describe("isBlockedIPv4", () => {
  it("blocks loopback and RFC1918 ranges", () => {
    expect(isBlockedIPv4("127.0.0.1")).toBe(true);
    expect(isBlockedIPv4("10.0.0.5")).toBe(true);
    expect(isBlockedIPv4("172.16.0.1")).toBe(true);
    expect(isBlockedIPv4("192.168.1.10")).toBe(true);
    expect(isBlockedIPv4("169.254.169.254")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isBlockedIPv4("8.8.8.8")).toBe(false);
    expect(isBlockedIPv4("1.1.1.1")).toBe(false);
  });
});

describe("isBlockedIPv6", () => {
  it("blocks loopback and ULA/link-local", () => {
    expect(isBlockedIPv6("::1")).toBe(true);
    expect(isBlockedIPv6("fc00::1")).toBe(true);
    expect(isBlockedIPv6("fe80::1")).toBe(true);
    expect(isBlockedIPv6("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("isBlockedHostAddress", () => {
  it("blocks unknown address families", () => {
    expect(isBlockedHostAddress("not-an-ip")).toBe(true);
  });
});

describe("assertSafeRemoteUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeRemoteUrl("file:///etc/passwd")).rejects.toThrow(/scheme/i);
    await expect(assertSafeRemoteUrl("gopher://example.com")).rejects.toThrow(/scheme/i);
  });

  it("rejects literal private IPs", async () => {
    await expect(assertSafeRemoteUrl("http://127.0.0.1:3001/")).rejects.toThrow(/blocked/i);
    await expect(assertSafeRemoteUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /blocked/i
    );
    await expect(assertSafeRemoteUrl("http://192.168.0.1/")).rejects.toThrow(/blocked/i);
  });

  it("rejects localhost hostnames", async () => {
    await expect(assertSafeRemoteUrl("http://localhost/admin")).rejects.toThrow(/blocked/i);
    await expect(assertSafeRemoteUrl("http://metadata.google.internal/")).rejects.toThrow(
      /blocked/i
    );
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertSafeRemoteUrl("http://user:pass@example.com/")).rejects.toThrow(
      /credentials/i
    );
  });

  it("allows public hostnames when DNS resolves to public IPs", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertSafeRemoteUrl("https://example.com/path");
    expect(url.hostname).toBe("example.com");
    vi.restoreAllMocks();
  });

  it("rejects hostnames that resolve to private IPs", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertSafeRemoteUrl("https://evil.example.net/")).rejects.toThrow(/SSRF blocked/i);
    vi.restoreAllMocks();
  });
});
