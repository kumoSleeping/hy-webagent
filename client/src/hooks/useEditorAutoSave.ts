import { useCallback, useEffect, useRef } from "react";

const AUTO_SAVE_MS = 600;

interface AutoSaveTab {
  id: string;
  path: string;
  content: string;
}

export function useEditorAutoSave(
  tabs: AutoSaveTab[],
  writeFile: (path: string, content: string) => Promise<void>
) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastSavedRef = useRef<Map<string, string>>(new Map());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    for (const tab of tabs) {
      if (!lastSavedRef.current.has(tab.id)) {
        lastSavedRef.current.set(tab.id, tab.content);
      }
    }
  }, [tabs]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const persist = useCallback(
    async (tabId: string, content: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      if (lastSavedRef.current.get(tabId) === content) return;
      await writeFile(tab.path, content);
      lastSavedRef.current.set(tabId, content);
    },
    [writeFile]
  );

  const scheduleSave = useCallback(
    (tabId: string, content: string) => {
      if (lastSavedRef.current.get(tabId) === content) return;
      const pending = timersRef.current.get(tabId);
      if (pending) clearTimeout(pending);
      timersRef.current.set(
        tabId,
        setTimeout(() => {
          timersRef.current.delete(tabId);
          void persist(tabId, content);
        }, AUTO_SAVE_MS)
      );
    },
    [persist]
  );

  const flushSave = useCallback(
    async (tabId: string, content: string) => {
      const pending = timersRef.current.get(tabId);
      if (pending) {
        clearTimeout(pending);
        timersRef.current.delete(tabId);
      }
      await persist(tabId, content);
    },
    [persist]
  );

  const discardTab = useCallback((tabId: string) => {
    const pending = timersRef.current.get(tabId);
    if (pending) {
      clearTimeout(pending);
      timersRef.current.delete(tabId);
    }
    lastSavedRef.current.delete(tabId);
  }, []);

  return { scheduleSave, flushSave, discardTab };
}
