import { useMemo } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { useStatusBarStore } from "../../stores/statusBarStore";
import { ExtensionDialogHost, type ExtensionUiResponder } from "../extension-ui/ExtensionDialogHost";
import { ExtensionWidgetBody, hasVisibleWidgets, primaryWidgetLabel } from "../extension-ui/ExtensionWidgetBody";
import { EditorPanel } from "../editor/EditorPanel";
import type { EditorTab, EditorViewMode } from "../../types";

export type CenterStageMode = "dialog" | "preview" | "extension";

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
}

/** Center panel above composer — file preview, extension widgets, extension dialogs. */
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
}: CenterStageProps) {
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = useMemo(() => hasVisibleWidgets(aboveEditor), [aboveEditor]);

  const mode: CenterStageMode | null = useMemo(() => {
    if (activeDialog) return "dialog";
    if (previewOpen) return "preview";
    if (hasExtension && !dismissed) return "extension";
    return null;
  }, [activeDialog, previewOpen, hasExtension, dismissed]);

  if (!mode) return null;

  function handleClose() {
    if (activeDialog) {
      onRespondExtensionUi({ id: activeDialog.id, cancelled: true });
      useExtensionUiStore.getState().setDialog(null);
      return;
    }
    onClose();
  }

  const label =
    mode === "dialog"
      ? activeDialog?.title || "Confirm"
      : primaryWidgetLabel(aboveEditor);

  return (
    <div
      className={`pi-center-stage ${mode === "preview" ? "pi-center-stage--preview" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      {mode === "preview" ? (
        <EditorPanel
          tabs={editorTabs}
          activeTabId={activeTabId}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          onContentChange={onContentChange}
          onViewModeChange={onViewModeChange}
          onEditorFocus={onEditorFocus}
        />
      ) : (
        <>
          <div className="pi-center-stage-header">
            <span className="pi-center-stage-label">{label}</span>
            <button type="button" className="pi-center-stage-close" onClick={handleClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="pi-center-stage-body">
            {mode === "dialog" && <ExtensionDialogHost onRespond={onRespondExtensionUi} />}
            {mode === "extension" && (
              <div className="pi-center-stage-scroll">
                <ExtensionWidgetBody aboveEditor={aboveEditor} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function useCenterStageOpen(): boolean {
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = hasVisibleWidgets(aboveEditor);
  return Boolean(activeDialog || previewOpen || (hasExtension && !dismissed));
}
