import { X } from "lucide-react";
import { EditorPanel } from "../editor/EditorPanel";
import type { EditorTab, EditorViewMode } from "../../types";

interface FilePreviewWindowProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onViewModeChange: (tabId: string, viewMode: EditorViewMode) => void;
  onClose: () => void;
}

/**
 * A small floating window for previewing/editing files — never full-screen.
 * It inherits the chat dialog's own column width (its parent caps width via
 * `.pi-interactive-shell`), pops up from the composer, and stays well short
 * of the full viewport height so the conversation stays primary.
 */
export function FilePreviewWindow({
  tabs, activeTabId, onTabClick, onTabClose, onContentChange, onViewModeChange, onClose,
}: FilePreviewWindowProps) {
  return (
    <div className="pi-glass pi-file-preview relative animate-[pi-pop-in_220ms_ease-out]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close file preview"
        className="absolute top-1 right-1 z-10 p-1 text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer"
      >
        <X size={14} />
      </button>
      <div className="flex-1 min-h-0">
        <EditorPanel
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          onContentChange={onContentChange}
          onViewModeChange={onViewModeChange}
        />
      </div>
    </div>
  );
}
