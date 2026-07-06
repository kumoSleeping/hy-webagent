export type StartupComposerPosition = "auto" | "center" | "bottom";

export interface StartupPreferences {
  welcomeEnabled: boolean;
  composerPosition: StartupComposerPosition;
}

export const STARTUP_PREFERENCES_STORAGE_KEY = "pi-startup-preferences";

export const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
  welcomeEnabled: false,
  composerPosition: "auto",
};

const COMPOSER_POSITIONS = new Set<StartupComposerPosition>(["auto", "center", "bottom"]);

export function resolveCenteredStartup(
  position: StartupComposerPosition,
  isMobileLayout: boolean,
): boolean {
  if (position === "center") return true;
  if (position === "bottom") return false;
  return !isMobileLayout;
}

export function loadStartupPreferences(): StartupPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_STARTUP_PREFERENCES };

  try {
    const raw = window.localStorage.getItem(STARTUP_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STARTUP_PREFERENCES };

    const parsed = JSON.parse(raw) as Partial<StartupPreferences>;
    const composerPosition = COMPOSER_POSITIONS.has(parsed.composerPosition as StartupComposerPosition)
      ? (parsed.composerPosition as StartupComposerPosition)
      : DEFAULT_STARTUP_PREFERENCES.composerPosition;

    return {
      welcomeEnabled: Boolean(parsed.welcomeEnabled),
      composerPosition,
    };
  } catch {
    return { ...DEFAULT_STARTUP_PREFERENCES };
  }
}

export function saveStartupPreferences(preferences: StartupPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STARTUP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}
