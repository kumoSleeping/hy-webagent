import { create } from "zustand";

export type ComposerPanelKind = "commands" | "model" | "tree" | "history" | "files" | "account" | null;
export type TreePanelMode = "tree" | "fork";

interface ComposerPanelState {
  panel: ComposerPanelKind;
  previewOpen: boolean;
  /** Tree panel mode when opened via toolbar or /tree vs /fork. */
  treeMode: TreePanelMode;
  /** Which toolbar slot the ←/→ keyboard cursor currently sits on. */
  toolbarIndex: number;
  /** True while the keyboard cursor sits on the toolbar row itself. */
  toolbarKeyboardFocus: boolean;
  togglePanel: (panel: Exclude<ComposerPanelKind, null>) => void;
  toggleFilesPanel: () => void;
  setPanel: (panel: ComposerPanelKind) => void;
  closePanel: () => void;
  openPreview: () => void;
  closePreview: () => void;
  closeAll: () => void;
  openModelPanel: () => void;
  openTreePanel: (mode?: TreePanelMode) => void;
  setToolbarIndex: (index: number) => void;
  setToolbarKeyboardFocus: (focus: boolean) => void;
}

export const useComposerPanelStore = create<ComposerPanelState>((set) => ({
  panel: null,
  previewOpen: false,
  treeMode: "tree",
  toolbarIndex: 0,
  toolbarKeyboardFocus: false,

  togglePanel: (panel) =>
    set((s) => {
      const closing = s.panel === panel;
      return {
        panel: closing ? null : panel,
        previewOpen: closing ? s.previewOpen : panel === "files" ? s.previewOpen : false,
        treeMode: panel === "tree" && !closing ? "tree" : s.treeMode,
      };
    }),
  setPanel: (panel) =>
    set((s) => ({
      panel,
      previewOpen: panel && panel !== "files" ? false : s.previewOpen,
    })),
  closePanel: () => set({ panel: null }),
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
      return { panel: closing ? null : "files" };
    }),
  closeAll: () => set({ panel: null, previewOpen: false }),
  openModelPanel: () => set({ panel: "model", previewOpen: false }),
  openTreePanel: (mode = "tree") =>
    set({ panel: "tree", treeMode: mode, previewOpen: false }),
  setToolbarIndex: (toolbarIndex) => set({ toolbarIndex }),
  setToolbarKeyboardFocus: (toolbarKeyboardFocus) => set({ toolbarKeyboardFocus }),
}));
