import { create } from "zustand";

export interface FooterSnapshot {
  pwdLine: string;
  statsLeft: string;
  modelRight: string;
  extensionLine: string | null;
}

export interface WidgetSnapshot {
  aboveEditor: Record<string, string[]>;
  belowEditor: Record<string, string[]>;
}

interface StatusBarState {
  footer: FooterSnapshot | null;
  widgets: WidgetSnapshot;
  /** Legacy keyed plugin statuses from setStatus (also in footer.extensionLine). */
  pluginStatuses: Record<string, string>;
  /** Rotating Working… line from ExtensionUIContext.setWorkingMessage. */
  workingMessage: string | null;
  setFooter: (footer: FooterSnapshot) => void;
  setWidgets: (widgets: WidgetSnapshot) => void;
  setPluginStatus: (key: string, text: string | null | undefined) => void;
  applyPluginSnapshot: (items: Record<string, string>) => void;
  setWorkingMessage: (message: string | null | undefined) => void;
  clear: () => void;
}

const emptyWidgets: WidgetSnapshot = { aboveEditor: {}, belowEditor: {} };

/** WS / REST sometimes send `{}` — always keep aboveEditor/belowEditor objects. */
export function normalizeWidgetSnapshot(
  widgets: Partial<WidgetSnapshot> | null | undefined
): WidgetSnapshot {
  return {
    aboveEditor: widgets?.aboveEditor ?? {},
    belowEditor: widgets?.belowEditor ?? {},
  };
}

export const useStatusBarStore = create<StatusBarState>((set) => ({
  footer: null,
  widgets: emptyWidgets,
  pluginStatuses: {},
  workingMessage: null,

  setFooter: (footer) => set({ footer }),

  setWidgets: (widgets) =>
    set((s) => {
      const normalized = normalizeWidgetSnapshot(widgets);
      if (JSON.stringify(s.widgets) === JSON.stringify(normalized)) return s;
      return { widgets: normalized };
    }),

  setPluginStatus: (key, text) =>
    set((s) => {
      const next = { ...s.pluginStatuses };
      if (!text) delete next[key];
      else next[key] = text;
      return { pluginStatuses: next };
    }),

  applyPluginSnapshot: (items) => set({ pluginStatuses: { ...items } }),

  setWorkingMessage: (message) =>
    set((s) => {
      const next = message?.trim() ? message.trim() : null;
      if (s.workingMessage === next) return s;
      return { workingMessage: next };
    }),

  clear: () => set({ footer: null, widgets: emptyWidgets, pluginStatuses: {}, workingMessage: null }),
}));

/** Split a below-editor widget line that uses NBSP padding (timer + signature). */
export function splitWidgetLine(line: string): { left: string; right: string } {
  const normalized = line.replace(/\u00A0/g, " ");
  const trimmed = normalized.trimEnd();
  const atMatch = trimmed.match(/^(.*?)(\s+)(@\S+)\s*$/);
  if (atMatch) {
    return { left: atMatch[1]!.trimEnd(), right: atMatch[3]! };
  }
  return { left: trimmed, right: "" };
}

export function hasStatusContent(state: Pick<StatusBarState, "footer" | "widgets">): boolean {
  const { footer, widgets } = state;
  const normalized = normalizeWidgetSnapshot(widgets);
  if (footer?.pwdLine || footer?.statsLeft || footer?.modelRight || footer?.extensionLine) return true;
  if (Object.keys(normalized.aboveEditor).length > 0) return true;
  if (Object.keys(normalized.belowEditor).length > 0) return true;
  return false;
}
