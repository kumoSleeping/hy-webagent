import { useMemo, type ReactNode } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useComposerPanelStore, type TreePanelMode } from "../../stores/composerPanelStore";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { useStatusBarStore } from "../../stores/statusBarStore";
import { ExtensionDialogHost, type ExtensionUiResponder } from "../extension-ui/ExtensionDialogHost";
import { ExtensionWidgetBody, hasVisibleWidgets, primaryWidgetLabel } from "../extension-ui/ExtensionWidgetBody";
import { EditorPanel } from "../editor/EditorPanel";
import { isElevatedPanel } from "../../lib/composerLayout";
import type { EditorTab, EditorViewMode } from "../../types";

export type CenterStageMode = "dialog" | "preview" | "tree" | "extension";

interface CenterStageProps {
  onRespondExtensionUi: ExtensionUiResponder;
  editorTabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onViewModeChange: (tabId: string, viewMode: EditorViewMode) => void;
  onEditorFocus?: () => void;
  onClose: () => void;
  treeContent?: ReactNode;
  treeMode?: TreePanelMode;
}

/** Large panel shell above composer — same chrome for tree / dialog / extension. */
export function CenterStage({
  onRespondExtensionUi,
  editorTabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onContentChange,
  onViewModeChange,
  onEditorFocus,
  onClose,
  treeContent,
  treeMode = "tree",
}: CenterStageProps) {
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  const composerPanel = useComposerPanelStore((s) => s.panel);
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = useMemo(() => hasVisibleWidgets(aboveEditor), [aboveEditor]);

  const mode: CenterStageMode | null = useMemo(() => {
    if (activeDialog) return "dialog";
    if (previewOpen) return "preview";
    if (composerPanel === "tree") return "tree";
    if (hasExtension && !dismissed) return "extension";
    return null;
  }, [activeDialog, previewOpen, composerPanel, hasExtension, dismissed]);

  if (!mode) return null;

  function handleClose() {
    if (activeDialog) {
      onRespondExtensionUi({ id: activeDialog.id, cancelled: true });
      useExtensionUiStore.getState().setDialog(null);
      return;
    }
    if (mode === "tree") {
      useComposerPanelStore.getState().closePanel();
      return;
    }
    onClose();
  }

  const label =
    mode === "dialog"
      ? activeDialog?.title || "Confirm"
      : mode === "tree"
        ? (treeMode === "fork" ? "Fork" : "Tree")
        : mode === "preview"
          ? "Preview"
          : primaryWidgetLabel(aboveEditor);

  // File preview must keep `--preview` (fixed height for Monaco) + headless chrome.
  if (mode === "preview") {
    return (
      <div
        className="pi-center-stage pi-center-stage--preview pi-center-stage--headless"
        onClick={(e) => e.stopPropagation()}
      >
        <EditorPanel
          tabs={editorTabs}
          activeTabId={activeTabId}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          onContentChange={onContentChange}
          onViewModeChange={onViewModeChange}
          onEditorFocus={onEditorFocus}
          showTabBar={false}
        />
      </div>
    );
  }

  // Large panels (tree / dialog / extension): shared header; tree reuses preview height.
  const tall = mode === "tree";
  return (
    <div
      className={`pi-center-stage${tall ? " pi-center-stage--preview" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pi-center-stage-header">
        <span className="pi-center-stage-label">{label}</span>
        <button type="button" className="pi-center-stage-close" onClick={handleClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="pi-center-stage-body">
        {mode === "dialog" && <ExtensionDialogHost onRespond={onRespondExtensionUi} />}
        {mode === "tree" && treeContent}
        {mode === "extension" && (
          <div className="pi-center-stage-scroll">
            <ExtensionWidgetBody aboveEditor={aboveEditor} />
          </div>
        )}
      </div>
    </div>
  );
}

export function useCenterStageOpen(isMobileLayout = false): boolean {
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  const composerPanel = useComposerPanelStore((s) => s.panel);
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = hasVisibleWidgets(aboveEditor);
  return Boolean(
    activeDialog ||
      previewOpen ||
      isElevatedPanel(composerPanel, isMobileLayout) ||
      (hasExtension && !dismissed)
  );
}
