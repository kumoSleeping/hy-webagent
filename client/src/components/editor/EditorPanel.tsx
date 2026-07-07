import { lazy, Suspense } from "react";
import { Eye, Pencil } from "lucide-react";
import { MediaPreview } from "./MediaPreview";
import { EditorTabs } from "./EditorTabs";
import { isMarkdownFile } from "../../lib/markdownFile";
import type { EditorTab, EditorViewMode } from "../../types";

const MonacoEditor = lazy(() =>
  import("./MonacoEditor").then((m) => ({ default: m.MonacoEditor }))
);
const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((m) => ({ default: m.MarkdownPreview }))
);

function EditorFallback() {
  return (
    <div className="flex items-center justify-center h-full bg-[var(--pi-bg)]">
      <div className="pi-spinner" />
    </div>
  );
}

interface EditorPanelProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onViewModeChange: (tabId: string, viewMode: EditorViewMode) => void;
  onEditorFocus?: () => void;
  /** When false, hide the tab strip (center-stage file preview). */
  showTabBar?: boolean;
}

export function EditorPanel({
  tabs, activeTabId, onTabClick, onTabClose, onContentChange, onViewModeChange, onEditorFocus,
  showTabBar = true,
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
      {showTabBar ? (
        <EditorTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          trailing={viewToggle}
        />
      ) : viewToggle ? (
        <div className="pi-editor-floating-tools">{viewToggle}</div>
      ) : null}
      <div className="pi-editor-body">
        {activeTab ? (
          activeTab.mediaType ? (
            <MediaPreview
              dataUrl={activeTab.content}
              mediaType={activeTab.mediaType}
              name={activeTab.name}
            />
          ) : activeTab.viewMode === "preview" && markdown ? (
            <Suspense fallback={<EditorFallback />}>
              <MarkdownPreview
                content={activeTab.content}
                onEnterEdit={() => onViewModeChange(activeTab.id, "edit")}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<EditorFallback />}>
              <MonacoEditor
                tab={activeTab}
                onChange={(content) => onContentChange(activeTab.id, content)}
                onFocus={onEditorFocus}
              />
            </Suspense>
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
