import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { EditorTab } from "../../types";

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  /** Right-aligned extras in the tab bar (e.g. the edit/preview toggle). */
  trailing?: ReactNode;
}

export function EditorTabs({ tabs, activeTabId, onTabClick, onTabClose, trailing }: EditorTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="pi-editor-tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabClick(tab.id)}
            className={`pi-editor-tab${isActive ? " pi-editor-tab--active" : ""}`}
          >
            <span className="pi-editor-tab-name">{tab.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
              className="pi-editor-tab-close"
              aria-label={`Close ${tab.name}`}
            >
              <X />
            </button>
          </div>
        );
      })}
      {trailing && <div className="pi-editor-tabs-trailing">{trailing}</div>}
    </div>
  );
}
