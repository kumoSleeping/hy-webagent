import { describe, it, expect, beforeEach } from "vitest";
import { registerWebChromeSlot, getWebChromeSlots } from "./registry";

describe("web-chrome registry", () => {
  beforeEach(() => {
    getWebChromeSlots().forEach((s) => {
      const idx = getWebChromeSlots().findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        // registry has no clear-all; unregister via returned fn in bootstrap only
      }
    });
  });

  it("registers slots by region", () => {
    const Mock = () => null;
    const off = registerWebChromeSlot({ id: "test-slot", region: "left", order: 99, component: Mock });
    expect(getWebChromeSlots("left").some((s) => s.id === "test-slot")).toBe(true);
    off();
    expect(getWebChromeSlots("left").some((s) => s.id === "test-slot")).toBe(false);
  });
});
