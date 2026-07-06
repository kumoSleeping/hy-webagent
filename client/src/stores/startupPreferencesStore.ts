import { create } from "zustand";
import {
  DEFAULT_STARTUP_PREFERENCES,
  loadStartupPreferences,
  saveStartupPreferences,
  type StartupComposerPosition,
  type StartupPreferences,
} from "../lib/startupPreferences";

interface StartupPreferencesState extends StartupPreferences {
  setWelcomeEnabled: (welcomeEnabled: boolean) => void;
  setComposerPosition: (composerPosition: StartupComposerPosition) => void;
}

function snapshot(state: StartupPreferencesState): StartupPreferences {
  return {
    welcomeEnabled: state.welcomeEnabled,
    composerPosition: state.composerPosition,
  };
}

export const useStartupPreferencesStore = create<StartupPreferencesState>((set, get) => ({
  ...loadStartupPreferences(),
  setWelcomeEnabled: (welcomeEnabled) => {
    set({ welcomeEnabled });
    saveStartupPreferences(snapshot({ ...get(), welcomeEnabled }));
  },
  setComposerPosition: (composerPosition) => {
    set({ composerPosition });
    saveStartupPreferences(snapshot({ ...get(), composerPosition }));
  },
}));

export function resetStartupPreferencesForTests() {
  useStartupPreferencesStore.setState({ ...DEFAULT_STARTUP_PREFERENCES });
}
