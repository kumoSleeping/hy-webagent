import { useMemo } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { useStatusBarStore } from "../../stores/statusBarStore";
import { ExtensionDialogHost, type ExtensionUiResponder } from "../extension-ui/ExtensionDialogHost";
import { ExtensionWidgetBody, hasVisibleWidgets, primaryWidgetLabel } from "../extension-ui/ExtensionWidgetBody";

export type CenterStageMode = "dialog" | "extension";

interface CenterStageProps {
  onRespondExtensionUi: ExtensionUiResponder;
  onClose: () => void;
}

/** Workbench shell above composer — extension dialogs & widgets only.
 * (树面板与文件预览都已并入独立悬浮小窗,不再是这里的 mode。) */
export function CenterStage({ onRespondExtensionUi, onClose }: CenterStageProps) {
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = useMemo(() => hasVisibleWidgets(aboveEditor), [aboveEditor]);

  const mode: CenterStageMode | null = useMemo(() => {
    if (activeDialog) return "dialog";
    if (hasExtension && !dismissed) return "extension";
    return null;
  }, [activeDialog, hasExtension, dismissed]);

  if (!mode) return null;

  function handleClose() {
    if (activeDialog) {
      onRespondExtensionUi({ id: activeDialog.id, cancelled: true });
      useExtensionUiStore.getState().setDialog(null);
      return;
    }
    onClose();
  }

  const label = mode === "dialog" ? activeDialog?.title || "Confirm" : primaryWidgetLabel(aboveEditor);

  return (
    <div className="pi-center-stage" onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}

export function useCenterStageOpen(_isMobileLayout = false): boolean {
  const activeDialog = useExtensionUiStore((s) => s.activeDialog);
  const dismissed = useExtensionUiStore((s) => s.extensionPanelDismissed);
  const aboveEditor = useStatusBarStore(useShallow((s) => s.widgets.aboveEditor));
  const hasExtension = hasVisibleWidgets(aboveEditor);
  return Boolean(activeDialog || (hasExtension && !dismissed));
}
