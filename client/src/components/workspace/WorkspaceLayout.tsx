import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useChatStore } from "../../stores/chatStore";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { ChatPanel } from "../chat/ChatPanel";
import { useChatConnection } from "../../context/useChatConnection";
import { useEditorAutoSave } from "../../hooks/useEditorAutoSave";
import { apiGet, apiPost } from "../../lib/api";
import { chatPath } from "../../lib/chatRoutes";
import { dataUrlForMedia, getMediaType } from "../../lib/mediaType";
import type { FileEntry, EditorTab, EditorViewMode } from "../../types";
import { defaultViewModeForFile } from "../../lib/markdownFile";

export function WorkspaceLayout() {
  const navigate = useNavigate();
  const chat = useChatConnection();
  const openPreview = useComposerPanelStore((s) => s.openPreview);
  const closePreview = useComposerPanelStore((s) => s.closePreview);
  const closeFilesPanelIfOpen = useCallback(() => {
    if (useComposerPanelStore.getState().panel === "files") {
      useComposerPanelStore.getState().closePanel();
    }
  }, []);

  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const writeFile = useCallback(async (path: string, content: string) => {
    await apiPost("/api/files/write", { filePath: path, content });
  }, []);

  const { scheduleSave, flushSave, discardTab } = useEditorAutoSave(editorTabs, writeFile);

  async function handleNewChat() {
    // Navigate to /chat/new immediately — the route handler creates the
    // session and redirects to /chat/:id when ready. This keeps the URL
    // stable during creation (no ID flash) and prevents rapid-click races.
    useChatStore.getState().resetForSessionChange();
    navigate(chatPath("new"), { replace: true });
  }

  const handleFileClick = useCallback(async (entry: FileEntry) => {
    if (entry.type !== "file") return;
    const existing = editorTabs.find((t) => t.path === entry.path);
    if (existing) {
      setActiveTabId(existing.id);
      openPreview();
      return;
    }
    try {
      const mediaType = getMediaType(entry.name);
      if (mediaType) {
        const data = await apiGet<{ mimeType: string; data: string }>(
          `/api/files/media?path=${encodeURIComponent(entry.path)}`
        );
        const tab: EditorTab = {
          id: entry.path,
          path: entry.path,
          name: entry.name,
          content: dataUrlForMedia(entry.name, data.data),
          language: mediaType,
          viewMode: "preview",
          mediaType,
        };
        setEditorTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
        openPreview();
        return;
      }
      const data = await apiGet<{ path: string; content: string }>(
        `/api/files/read?path=${encodeURIComponent(entry.path)}`
      );
      const ext = entry.name.split(".").pop()?.toLowerCase() || "";
      const tab: EditorTab = {
        id: entry.path,
        path: entry.path,
        name: entry.name,
        content: data.content ?? "",
        language: ext,
        viewMode: defaultViewModeForFile(entry.name),
      };
      setEditorTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      openPreview();
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [editorTabs, openPreview]);

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setEditorTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, content } : t)));
    scheduleSave(tabId, content);
  }, [scheduleSave]);

  const handleViewModeChange = useCallback((tabId: string, viewMode: EditorViewMode) => {
    setEditorTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, viewMode } : t)));
  }, []);

  const handleTabClose = useCallback((tabId: string) => {
    const tab = editorTabs.find((t) => t.id === tabId);
    if (tab && !tab.mediaType) {
      void flushSave(tab.id, tab.content);
    }
    if (tab) discardTab(tabId);
    setEditorTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      setActiveTabId((curr) => (curr === tabId ? (filtered.length ? filtered[filtered.length - 1].id : null) : curr));
      if (filtered.length === 0) closePreview();
      return filtered;
    });
  }, [editorTabs, flushSave, discardTab, closePreview]);

  return (
    <div className="relative flex h-full bg-[var(--pi-bg)] overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatPanel
          chat={chat}
          onNewChat={handleNewChat}
          onFileClick={handleFileClick}
          editorTabs={editorTabs}
          activeTabId={activeTabId}
          onTabClick={setActiveTabId}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          onViewModeChange={handleViewModeChange}
          onEditorFocus={closeFilesPanelIfOpen}
        />
      </div>
    </div>
  );
}
