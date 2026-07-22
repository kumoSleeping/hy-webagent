import { describe, it, expect } from "vitest";
import { summarizeProviderError } from "./providerError";

describe("summarizeProviderError", () => {
  it("shortens Cloudflare HTML blocks", () => {
    const raw = `<!DOCTYPE html><title>Attention Required! | Cloudflare</title>
      <h2>You are unable to access</h2><span>soruxgpt.com</span>`;
    expect(summarizeProviderError(raw)).toContain("Cloudflare 403");
    expect(summarizeProviderError(raw)).toContain("soruxgpt.com");
  });

  it("keeps plain API errors readable", () => {
    expect(summarizeProviderError("分组 grok-cli 下模型 grok-5.4 无可用渠道")).toContain("无可用渠道");
  });
});
