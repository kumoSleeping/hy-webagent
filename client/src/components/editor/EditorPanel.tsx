import { Eye, Pencil } from "lucide-react";
import { MonacoEditor } from "./MonacoEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { MediaPreview } from "./MediaPreview";
import { EditorTabs } from "./EditorTabs";
import { isMarkdownFile } from "../../lib/markdownFile";
import type { EditorTab, EditorViewMode } from "../../types";

interface EditorPanelProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onViewModeChange: (tabId: string, viewMode: EditorViewMode) => void;
  onEditorFocus?: () => void;
}

export function EditorPanel({
  tabs, activeTabId, onTabClick, onTabClose, onContentChange, onViewModeChange, onEditorFocus,
}: EditorPanelProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const markdown = activeTab ? isMarkdownFile(activeTab.name) : false;
  const inPreview = activeTab?.viewMode === "preview";

  const viewToggle = activeTab && markdown ? (
    <button
      type="button"
      className="pi-editor-view-toggle"
      onClick={(e) => {
        e.stopPropagation();
        onViewModeChange(activeTab.id, inPreview ? "edit" : "preview");
      }}
      aria-label={inPreview ? "切换到编辑" : "切换到预览"}
      title={inPreview ? "编辑" : "预览"}
    >
      {inPreview ? (
        <Pencil strokeWidth={2} aria-hidden="true" />
      ) : (
        <Eye strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  ) : null;

  return (
    <div className="pi-editor-panel">
      <EditorTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        trailing={viewToggle}
      />
      <div className="pi-editor-body">
        {activeTab ? (
          activeTab.mediaType ? (
            <MediaPreview
              dataUrl={activeTab.content}
              mediaType={activeTab.mediaType}
              name={activeTab.name}
            />
          ) : activeTab.viewMode === "preview" && markdown ? (
            <MarkdownPreview
              content={activeTab.content}
              onEnterEdit={() => onViewModeChange(activeTab.id, "edit")}
            />
          ) : (
            <MonacoEditor
              tab={activeTab}
              onChange={(content) => onContentChange(activeTab.id, content)}
              onFocus={onEditorFocus}
            />
          )
        ) : (
          <div className="pi-editor-empty">
            Open a file from the sidebar to start editing
          </div>
        )}
      </div>
    </div>
  );
}
