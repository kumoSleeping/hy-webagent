import { create } from "zustand";
import type { ExtensionDialogState } from "../types/extension-ui";

interface ExtensionUiState {
  activeDialog: ExtensionDialogState | null;
  composerDraft: string | null;
  extensionPanelDismissed: boolean;
  setDialog: (dialog: ExtensionDialogState | null) => void;
  setComposerDraft: (text: string | null) => void;
  setExtensionPanelDismissed: (dismissed: boolean) => void;
  clear: () => void;
}

export const useExtensionUiStore = create<ExtensionUiState>((set) => ({
  activeDialog: null,
  composerDraft: null,
  extensionPanelDismissed: false,
  setDialog: (activeDialog) => set({ activeDialog }),
  setComposerDraft: (composerDraft) => set({ composerDraft }),
  setExtensionPanelDismissed: (extensionPanelDismissed) => set({ extensionPanelDismissed }),
  clear: () => set({ activeDialog: null, composerDraft: null, extensionPanelDismissed: false }),
}));
