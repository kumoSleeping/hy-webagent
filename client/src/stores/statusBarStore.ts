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

export interface StatusFlash {
  text: string;
  kind: "info" | "error";
}

interface StatusBarState {
  footer: FooterSnapshot | null;
  /** 按会话缓存的最近一次 footer —— 切激活时先上缓存瞬时填充(不闪空),
   *  REST/WS 的新鲜数据到了再覆盖。 */
  footerCache: Record<string, FooterSnapshot>;
  widgets: WidgetSnapshot;
  /** Legacy keyed plugin statuses from setStatus (also in footer.extensionLine). */
  pluginStatuses: Record<string, string>;
  /** Rotating Working… line from ExtensionUIContext.setWorkingMessage. */
  workingMessage: string | null;
  /** Transient status-line message — the app's only notification surface
   *  (popup toasts were removed by design: flat status rail instead). */
  flash: StatusFlash | null;
  setFooter: (footer: FooterSnapshot) => void;
  /** 记缓存(不动当前显示)。 */
  cacheFooter: (piSessionId: string, footer: FooterSnapshot) => void;
  /** 切会话:有缓存立即换上,没有才清空等 REST。 */
  switchToSession: (piSessionId: string) => void;
  setWidgets: (widgets: WidgetSnapshot) => void;
  setPluginStatus: (key: string, text: string | null | undefined) => void;
  applyPluginSnapshot: (items: Record<string, string>) => void;
  setWorkingMessage: (message: string | null | undefined) => void;
  /** Show a transient message in the status rail; auto-clears. */
  setFlash: (text: string, kind?: StatusFlash["kind"], durationMs?: number) => void;
  clearFlash: () => void;
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

let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useStatusBarStore = create<StatusBarState>((set) => ({
  footer: null,
  footerCache: {},
  widgets: emptyWidgets,
  pluginStatuses: {},
  workingMessage: null,
  flash: null,

  setFooter: (footer) => set({ footer }),

  cacheFooter: (piSessionId, footer) =>
    set((s) => ({ footerCache: { ...s.footerCache, [piSessionId]: footer } })),

  switchToSession: (piSessionId) =>
    set((s) => ({
      footer: s.footerCache[piSessionId] ?? null,
      widgets: emptyWidgets,
      pluginStatuses: {},
      workingMessage: null,
    })),

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

  setFlash: (text, kind = "info", durationMs = 5000) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (flashTimer) clearTimeout(flashTimer);
    set({ flash: { text: trimmed, kind } });
    flashTimer = setTimeout(() => {
      flashTimer = null;
      set({ flash: null });
    }, durationMs);
  },

  clearFlash: () => {
    if (flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
    set({ flash: null });
  },

  clear: () => set({ footer: null, widgets: emptyWidgets, pluginStatuses: {}, workingMessage: null }),
}));

/** Convenience for non-React call sites (WS handlers, API helpers). */
export function flashStatus(text: string, kind: StatusFlash["kind"] = "info", durationMs?: number) {
  useStatusBarStore.getState().setFlash(text, kind, durationMs);
}

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
