import { describe, it, expect } from "vitest";
import { getAdminApiCatalog, formatCatalogText } from "../admin/catalog.js";

describe("admin catalog", () => {
  it("includes help endpoint and CLI commands", () => {
    const catalog = getAdminApiCatalog();
    expect(catalog.endpoints.some((e) => e.path === "/api/admin/help" && e.auth === "none")).toBe(true);
    expect(catalog.endpoints.some((e) => e.method === "POST" && e.path === "/api/admin/users")).toBe(true);
    expect(catalog.cli.commands.some((c) => c.command.startsWith("users create"))).toBe(true);
    expect(catalog.defaults.userBudgetUsd).toBe(2);
  });

  it("formatCatalogText mentions npm run admin", () => {
    const text = formatCatalogText(getAdminApiCatalog());
    expect(text).toContain("npm run admin");
    expect(text).toContain("/api/admin/help");
  });
});
