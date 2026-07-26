import { create } from "zustand";
import { useSessionWindowsStore } from "./sessionWindowsStore";

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
  openPreview: () => {
    // 每次打开(含重复点开同一文件)都升到浮层栈顶 —— ChatPanel 的
    // effect 只盯 previewOpen/activeTabId 变化,同文件重开不会触发。
    useSessionWindowsStore.getState().raisePreview();
    set({ previewOpen: true });
  },
  closePreview: () => set({ previewOpen: false }),
  // 预览已是独立小窗,files 面板与它互不抢台面 — 纯开关即可。
  toggleFilesPanel: () =>
    set((s) => ({ panel: s.panel === "files" ? null : "files" })),
  closeAll: () => set({ panel: null, previewOpen: false }),
  openModelPanel: () => set({ panel: "model", previewOpen: false }),
  openTreePanel: (mode = "tree") =>
    set({ panel: "tree", treeMode: mode, previewOpen: false }),
  setToolbarIndex: (toolbarIndex) => set({ toolbarIndex }),
  setToolbarKeyboardFocus: (toolbarKeyboardFocus) => set({ toolbarKeyboardFocus }),
}));
