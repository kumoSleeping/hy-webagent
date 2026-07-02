import { create } from "zustand";

export type ComposerPanelKind = "commands" | "model" | "tree" | "history" | "files" | "btw" | "account" | null;
export type TreePanelMode = "tree" | "fork";

interface ComposerPanelState {
  panel: ComposerPanelKind;
  previewOpen: boolean;
  /** User closed /btw panel — suppress auto-open until next /btw command. */
  btwPanelSuppressed: boolean;
  /** Tree panel mode when opened via toolbar or /tree vs /fork. */
  treeMode: TreePanelMode;
  /** Which toolbar slot (commands/tree/history/files/btw/new-chat) the ←/→
   * keyboard cursor currently sits on — always matches the open panel. */
  toolbarIndex: number;
  /** True while the keyboard cursor sits on the toolbar row itself (moved
   * there by ←/→, or by ↑ out of the top of a list). False once ↓ has
   * dropped focus into that panel's own list — at which point the panel
   * component (tree/files) or ComposerBar owns ↑/↓ for its list. Shared
   * here so tree/files can react without prop drilling. */
  toolbarKeyboardFocus: boolean;
  togglePanel: (panel: Exclude<ComposerPanelKind, null>) => void;
  toggleFilesPanel: () => void;
  setPanel: (panel: ComposerPanelKind) => void;
  closePanel: () => void;
  openPreview: () => void;
  closePreview: () => void;
  closeBtwPanel: () => void;
  closeAll: () => void;
  openBtwPanel: () => void;
  openModelPanel: () => void;
  openTreePanel: (mode?: TreePanelMode) => void;
  suppressBtwPanel: () => void;
  setToolbarIndex: (index: number) => void;
  setToolbarKeyboardFocus: (focus: boolean) => void;
}

export const useComposerPanelStore = create<ComposerPanelState>((set) => ({
  panel: null,
  previewOpen: false,
  btwPanelSuppressed: false,
  treeMode: "tree",
  toolbarIndex: 0,
  toolbarKeyboardFocus: false,

  togglePanel: (panel) =>
    set((s) => {
      const closing = s.panel === panel;
      if (panel === "btw") {
        if (closing) {
          return { panel: null, btwPanelSuppressed: true };
        }
        return { panel: "btw", previewOpen: false, btwPanelSuppressed: false };
      }
      return {
        panel: closing ? null : panel,
        previewOpen: closing ? s.previewOpen : panel === "files" ? s.previewOpen : false,
        treeMode: panel === "tree" && !closing ? "tree" : s.treeMode,
        btwPanelSuppressed: s.btwPanelSuppressed,
      };
    }),
  setPanel: (panel) =>
    set((s) => ({
      panel,
      previewOpen: panel && panel !== "files" ? false : s.previewOpen,
      btwPanelSuppressed: panel === "btw" ? false : s.btwPanelSuppressed,
    })),
  closePanel: () =>
    set((s) => ({
      panel: null,
      btwPanelSuppressed: s.panel === "btw" ? true : s.btwPanelSuppressed,
    })),
  openPreview: () => set({ previewOpen: true }),
  closePreview: () => set({ previewOpen: false }),
  closeBtwPanel: () => set({ panel: null, btwPanelSuppressed: true }),
  /** Preview open: files click dismisses overlay first, then closes preview. */
  toggleFilesPanel: () =>
    set((s) => {
      if (s.previewOpen) {
        if (s.panel === "files") {
          return { panel: null };
        }
        return { previewOpen: false, panel: null };
      }
      const closing = s.panel === "files";
      return { panel: closing ? null : "files" };
    }),
  closeAll: () =>
    set((s) => ({
      panel: null,
      previewOpen: false,
      btwPanelSuppressed: s.panel === "btw" ? true : s.btwPanelSuppressed,
    })),
  openBtwPanel: () => set({ panel: "btw", btwPanelSuppressed: false, previewOpen: false }),
  openModelPanel: () => set({ panel: "model", previewOpen: false, btwPanelSuppressed: false }),
  openTreePanel: (mode = "tree") =>
    set({ panel: "tree", treeMode: mode, previewOpen: false, btwPanelSuppressed: false }),
  suppressBtwPanel: () => set({ btwPanelSuppressed: true, panel: null }),
  setToolbarIndex: (toolbarIndex) => set({ toolbarIndex }),
  setToolbarKeyboardFocus: (toolbarKeyboardFocus) => set({ toolbarKeyboardFocus }),
}));
