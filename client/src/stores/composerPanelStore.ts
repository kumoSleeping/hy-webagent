import { create } from "zustand";

export type ComposerPanelKind = "commands" | "model" | "tree" | "history" | "files" | "account" | null;
export type TreePanelMode = "tree" | "fork";
/** 面板两态:hug = 贴身(高度跟内容,封顶 45dvh);stage = 满台(大卡)。 */
export type PanelStance = "hug" | "stage";

/** tree 天生满台(大卡);其余面板默认贴身。 */
export function defaultPanelStance(kind: Exclude<ComposerPanelKind, null>): PanelStance {
  return kind === "tree" ? "stage" : "hug";
}

interface ComposerPanelState {
  panel: ComposerPanelKind;
  previewOpen: boolean;
  /** Tree panel mode when opened via toolbar or /tree vs /fork. */
  treeMode: TreePanelMode;
  /** Stance of the currently open panel (undefined panel → value is stale, ignored). */
  stance: PanelStance;
  /** Per-kind stance memory — reopening a panel restores its last stance. */
  stanceByKind: Partial<Record<Exclude<ComposerPanelKind, null>, PanelStance>>;
  /** Which toolbar slot the ←/→ keyboard cursor currently sits on. */
  toolbarIndex: number;
  /** True while the keyboard cursor sits on the toolbar row itself. */
  toolbarKeyboardFocus: boolean;
  togglePanel: (panel: Exclude<ComposerPanelKind, null>) => void;
  toggleFilesPanel: () => void;
  setPanel: (panel: ComposerPanelKind) => void;
  closePanel: () => void;
  setStance: (stance: PanelStance) => void;
  openPreview: () => void;
  closePreview: () => void;
  closeAll: () => void;
  openModelPanel: () => void;
  openTreePanel: (mode?: TreePanelMode) => void;
  setToolbarIndex: (index: number) => void;
  setToolbarKeyboardFocus: (focus: boolean) => void;
}

function stanceFor(
  s: Pick<ComposerPanelState, "stanceByKind">,
  kind: Exclude<ComposerPanelKind, null>,
): PanelStance {
  return s.stanceByKind[kind] ?? defaultPanelStance(kind);
}

export const useComposerPanelStore = create<ComposerPanelState>((set) => ({
  panel: null,
  previewOpen: false,
  treeMode: "tree",
  stance: "hug",
  stanceByKind: {},
  toolbarIndex: 0,
  toolbarKeyboardFocus: false,

  togglePanel: (panel) =>
    set((s) => {
      const closing = s.panel === panel;
      return {
        panel: closing ? null : panel,
        stance: closing ? s.stance : stanceFor(s, panel),
        previewOpen: closing ? s.previewOpen : panel === "files" ? s.previewOpen : false,
        treeMode: panel === "tree" && !closing ? "tree" : s.treeMode,
      };
    }),
  setPanel: (panel) =>
    set((s) => ({
      panel,
      stance: panel ? stanceFor(s, panel) : s.stance,
      previewOpen: panel && panel !== "files" ? false : s.previewOpen,
    })),
  closePanel: () => set({ panel: null }),
  setStance: (stance) =>
    set((s) =>
      s.panel
        ? { stance, stanceByKind: { ...s.stanceByKind, [s.panel]: stance } }
        : {},
    ),
  openPreview: () =>
    set((s) => ({
      previewOpen: true,
      panel: s.panel === "tree" ? null : s.panel,
    })),
  closePreview: () => set({ previewOpen: false }),
  toggleFilesPanel: () =>
    set((s) => {
      // File preview pad is open — two-step close:
      //   1st click: close files sidebar, keep file preview
      //   2nd click: close file preview
      if (s.previewOpen) {
        if (s.panel === "files") {
          return { panel: null };
        }
        return { previewOpen: false };
      }
      // No preview open — simple toggle of files sidebar
      const closing = s.panel === "files";
      return closing
        ? { panel: null }
        : { panel: "files" as const, stance: stanceFor(s, "files") };
    }),
  closeAll: () => set({ panel: null, previewOpen: false }),
  openModelPanel: () =>
    set((s) => ({ panel: "model", stance: stanceFor(s, "model"), previewOpen: false })),
  openTreePanel: (mode = "tree") =>
    set((s) => ({ panel: "tree", stance: stanceFor(s, "tree"), treeMode: mode, previewOpen: false })),
  setToolbarIndex: (toolbarIndex) => set({ toolbarIndex }),
  setToolbarKeyboardFocus: (toolbarKeyboardFocus) => set({ toolbarKeyboardFocus }),
}));
