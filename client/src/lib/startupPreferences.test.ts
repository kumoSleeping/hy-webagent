import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_STARTUP_PREFERENCES,
  STARTUP_PREFERENCES_STORAGE_KEY,
  loadStartupPreferences,
  resolveCenteredStartup,
  saveStartupPreferences,
} from "./startupPreferences";

function mockLocalStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
}

describe("resolveCenteredStartup", () => {
  it("uses mobile bottom and desktop center for auto", () => {
    expect(resolveCenteredStartup("auto", true)).toBe(false);
    expect(resolveCenteredStartup("auto", false)).toBe(true);
    expect(resolveCenteredStartup("center", true)).toBe(true);
    expect(resolveCenteredStartup("bottom", false)).toBe(false);
  });
});

describe("startupPreferences storage", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("defaults to welcome off and auto layout", () => {
    expect(loadStartupPreferences()).toEqual(DEFAULT_STARTUP_PREFERENCES);
  });

  it("persists preferences in localStorage", () => {
    saveStartupPreferences({ welcomeEnabled: true, composerPosition: "center" });
    expect(window.localStorage.getItem(STARTUP_PREFERENCES_STORAGE_KEY)).toContain('"welcomeEnabled":true');
    expect(loadStartupPreferences()).toEqual({ welcomeEnabled: true, composerPosition: "center" });
  });
});
