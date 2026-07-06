import { create } from "zustand";

export type SlashCommandKind = "instant" | "args" | "panel" | "prompt" | "skill" | "extension";

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  kind: SlashCommandKind;
  source?: string;
}

export interface SlashToast {
  message: string;
  type?: "success" | "error" | "info";
}

export interface SlashState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  activePanel: string | null;
  commands: SlashCommand[];
  dynamicCommands: SlashCommand[];
  toast: SlashToast | null;
  lastResult: unknown | null;

  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setCommands: (commands: SlashCommand[]) => void;
  setDynamicCommands: (commands: SlashCommand[]) => void;
  selectNext: () => void;
  selectPrev: () => void;
  selectIndex: (index: number) => void;
  setActivePanel: (panel: string | null) => void;
  setLastResult: (result: unknown) => void;
  showToast: (toast: SlashToast) => void;
  clearToast: () => void;
}

export const defaultCommands: SlashCommand[] = [
  { id: "model", label: "model", description: "Pick a model", kind: "panel" },
  { id: "scoped-models", label: "scoped-models", description: "Models available in this context", kind: "panel" },
  { id: "settings", label: "settings", description: "Adjust thinking level and preferences", kind: "panel" },
  { id: "new", label: "new", description: "Start a new session", kind: "instant" },
  { id: "resume", label: "resume", description: "Open session history", kind: "instant" },
  { id: "fork", label: "fork", description: "Fork from conversation tree", kind: "instant" },
  { id: "tree", label: "tree", description: "Open conversation tree", kind: "instant" },
  { id: "compact", label: "compact", description: "Compact conversation history", kind: "instant" },
  { id: "name", label: "name", description: "Rename the session", kind: "args" },
  { id: "session", label: "session", description: "Session information", kind: "panel" },
  { id: "copy", label: "copy", description: "Copy the last message", kind: "instant" },
  { id: "export", label: "export", description: "Export session data", kind: "panel" },
  { id: "import", label: "import", description: "Import session data", kind: "args" },
  { id: "reload", label: "reload", description: "Reload extensions, skills, and prompts", kind: "instant" },
];

function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const needle = query.slice(1).toLowerCase().trim();
  if (!needle) return commands;
  return commands.filter(
    (c) =>
      c.id.toLowerCase().includes(needle) ||
      c.label.toLowerCase().includes(needle) ||
      c.description.toLowerCase().includes(needle)
  );
}

export function selectFilteredCommands(state: SlashState): SlashCommand[] {
  const all = [...state.commands, ...state.dynamicCommands];
  return filterCommands(all, state.query);
}

export const useSlashStore = create<SlashState>((set, get) => ({
  isOpen: false,
  query: "",
  selectedIndex: 0,
  activePanel: null,
  commands: defaultCommands,
  dynamicCommands: [],
  toast: null,
  lastResult: null,

  open: () => set({ isOpen: true, query: "", selectedIndex: 0 }),
  close: () => set({ isOpen: false, query: "", selectedIndex: 0 }),
  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setCommands: (commands) => set({ commands }),

  selectNext: () => {
    const filtered = selectFilteredCommands(get());
    const count = filtered.length || 1;
    set((s) => ({ selectedIndex: (s.selectedIndex + 1) % count }));
  },

  selectPrev: () => {
    const filtered = selectFilteredCommands(get());
    const count = filtered.length || 1;
    set((s) => ({ selectedIndex: (s.selectedIndex - 1 + count) % count }));
  },

  selectIndex: (index) => {
    const filtered = selectFilteredCommands(get());
    if (index >= 0 && index < filtered.length) {
      set({ selectedIndex: index });
    }
  },
  setActivePanel: (panel) => set({ activePanel: panel, isOpen: false }),
  setLastResult: (result) => set({ lastResult: result }),
  setDynamicCommands: (commands) => set({ dynamicCommands: commands }),
  showToast: (toast) => set({ toast }),
  clearToast: () => set({ toast: null }),
}));


