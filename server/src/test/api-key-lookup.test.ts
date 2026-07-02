import { describe, expect, it } from "vitest";
import { computeApiKeyLookup, resetApiKeyLookupSecretForTests } from "../api-key-lookup.js";

describe("api-key-lookup", () => {
  it("produces stable HMAC fingerprints", () => {
    resetApiKeyLookupSecretForTests();
    process.env.API_KEY_LOOKUP_SECRET = "test-secret";
    expect(computeApiKeyLookup("sk-hyw-Abcd1234")).toBe(computeApiKeyLookup("sk-hyw-Abcd1234"));
    expect(computeApiKeyLookup("sk-hyw-Abcd1234")).not.toBe(computeApiKeyLookup("sk-hyw-OtherKey9"));
    delete process.env.API_KEY_LOOKUP_SECRET;
    resetApiKeyLookupSecretForTests();
  });
});
