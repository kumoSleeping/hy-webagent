import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Folder, FolderOpen, File, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { apiGet } from "../../lib/api";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { PanelFilterBar } from "../common/PanelFilterBar";
import type { FileEntry } from "../../types";

interface FileTreeProps {
  onFileClick?: (entry: FileEntry) => void | Promise<void>;
}

interface TreeNode extends FileEntry {
  children?: TreeNode[];
  expanded: boolean;
  loading: boolean;
}

interface FlatFileEntry {
  node: TreeNode;
  depth: number;
}

/** True if this node or any descendant's name matches the query. */
function nodeMatches(node: TreeNode, needle: string): boolean {
  if (node.name.toLowerCase().includes(needle)) return true;
  return (node.children ?? []).some((child) => nodeMatches(child, needle));
}

/** Same visibility rule as `renderNode` (search match, expanded dirs)
 * but flattened to the order rows actually render in — the sequence the
 * ↑/↓ keyboard cursor walks. */
function flattenVisible(node: TreeNode, depth: number, needle: string): FlatFileEntry[] {
  if (needle && !nodeMatches(node, needle)) return [];
  const out: FlatFileEntry[] = [{ node, depth }];
  const showChildren = node.expanded && node.children && (!needle || node.type === "directory");
  if (showChildren) {
    for (const child of node.children!) {
      out.push(...flattenVisible(child, depth + 1, needle));
    }
  }
  return out;
}

/** Module-level cache — survives FileTree unmount/remount so the panel
 *  always shows entries from the previous load while fetching fresh data. */
const fileCache = new Map<string, FileEntry[]>();

export function FileTree({ onFileClick }: FileTreeProps) {
  const [root, setRoot] = useState<TreeNode>({
    name: "workspace", path: ".", type: "directory",
    children: [], expanded: true, loading: false,
  });
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  /** File path currently being fetched for preview — show a spinner after the name. */
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const toolbarKeyboardFocus = useComposerPanelStore((s) => s.toolbarKeyboardFocus);
  const setToolbarKeyboardFocus = useComposerPanelStore((s) => s.setToolbarKeyboardFocus);

  useEffect(() => {
    (async () => {
      const loaded = await loadChildren({ name: "workspace", path: ".", type: "directory", children: [], expanded: true, loading: false });
      setRoot((prev) => ({ ...prev, children: loaded.children, expanded: true }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChildren = useCallback(async (node: TreeNode): Promise<TreeNode> => {
    if (node.loading) return node;
    const cached = fileCache.get(node.path);
    const updated = { ...node, loading: true };
    // Show cached entries immediately while fetching fresh data.
    if (cached && !updated.children?.length) {
      updated.children = cached.map(e => ({
        ...e, children: e.type === "directory" ? [] : undefined,
        expanded: false, loading: false,
      }));
    }
    try {
      const entries = await apiGet<FileEntry[]>(`/api/files/list?path=${encodeURIComponent(node.path)}`);
      fileCache.set(node.path, entries);
      updated.children = entries.map(e => ({
        ...e, children: e.type === "directory" ? [] : undefined,
        expanded: false, loading: false,
      }));
    } catch (err) { console.error("Failed to load directory:", err); }
    updated.loading = false;
    return updated;
  }, []);

  async function toggleExpand(node: TreeNode) {
    if (node.expanded) {
      setRoot(prev => updateNode(prev, node.path, { expanded: false }));
      return;
    }
    const loaded = await loadChildren(node);
    setRoot(prev => updateNode(prev, node.path, { ...loaded, expanded: true }));
  }

  function updateNode(root: TreeNode, targetPath: string, updates: Partial<TreeNode>): TreeNode {
    if (root.path === targetPath) return { ...root, ...updates };
    if (!root.children) return root;
    return {
      ...root,
      children: root.children.map(c => updateNode(c, targetPath, updates)),
    };
  }

  const flatVisible = useMemo(() => flattenVisible(root, 0, needle), [root, needle]);

  useEffect(() => {
    if (flatVisible.length === 0) { setCursorPath(null); return; }
    if (cursorPath && flatVisible.some((f) => f.node.path === cursorPath)) return;
    setCursorPath(flatVisible[0].node.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisible]);

  useEffect(() => {
    if (!cursorPath) return;
    rowRefs.current.get(cursorPath)?.scrollIntoView({ block: "nearest" });
  }, [cursorPath]);

  function moveCursor(delta: number) {
    if (flatVisible.length === 0) return;
    const idx = flatVisible.findIndex((f) => f.node.path === cursorPath);
    const base = idx === -1 ? 0 : idx;
    const next = base + delta;
    if (next < 0) {
      setToolbarKeyboardFocus(true);
      return;
    }
    setCursorPath(flatVisible[(next + flatVisible.length) % flatVisible.length].node.path);
  }

  async function activateCursor() {
    const entry = flatVisible.find((f) => f.node.path === cursorPath);
    if (!entry) return;
    activateNode(entry.node);
  }

  useEffect(() => {
    if (toolbarKeyboardFocus) return;

    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); void activateCursor(); return; }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisible, cursorPath, toolbarKeyboardFocus]);

  async function activateNode(node: TreeNode) {
    setCursorPath(node.path);
    setToolbarKeyboardFocus(false);
    if (node.type === "directory") {
      await toggleExpand(node);
      return;
    }
    if (openingPath === node.path) return;
    setOpeningPath(node.path);
    try {
      await onFileClick?.(node);
    } finally {
      setOpeningPath((prev) => (prev === node.path ? null : prev));
    }
  }

  function renderNode(node: TreeNode, depth: number) {
    if (needle && !nodeMatches(node, needle)) return null;

    const isDir = node.type === "directory";
    const isExpanded = node.expanded && node.children;
    const isCursor = node.path === cursorPath;
    const showChildren = isExpanded || (needle && isDir && (node.children?.length ?? 0) > 0);

    return (
      <div key={node.path}>
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(node.path, el);
            else rowRefs.current.delete(node.path);
          }}
          role="button"
          tabIndex={-1}
          onClick={() => { void activateNode(node); }}
          className={`pi-panel-row flex items-center gap-1 px-2 py-0.5 text-base cursor-pointer transition-colors${
            isCursor ? " pi-panel-row--selected" : ""
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <span className="w-3.5 shrink-0 flex items-center justify-center">
            {isDir ? (
              node.loading ? <Loader2 size={14} className="animate-spin text-[var(--pi-muted)]" /> :
              <span onClick={(e) => { e.stopPropagation(); void toggleExpand(node); }}>
                {showChildren ? <ChevronDown size={14} className="text-[var(--pi-muted)]" /> : <ChevronRight size={14} className="text-[var(--pi-muted)]" />}
              </span>
            ) : null}
          </span>

          {isDir ? (
            showChildren ? <FolderOpen size={14} className="text-[var(--pi-accent)] shrink-0" /> :
            <Folder size={14} className="text-[var(--pi-muted)] shrink-0" />
          ) : (
            <File size={14} className="text-[var(--pi-muted)] shrink-0" />
          )}

          <span className="truncate min-w-0">{node.name}</span>
          {!isDir && openingPath === node.path ? (
            <Loader2
              size={12}
              className="shrink-0 animate-spin text-[var(--pi-theme)]"
              aria-label="Loading file"
            />
          ) : null}
        </div>

        {showChildren && node.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const hasLoadedChildren = (root.children?.length ?? 0) > 0;
  const noMatches = needle && hasLoadedChildren && !root.children!.some((child) => nodeMatches(child, needle));

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelFilterBar value={query} onChange={setQuery} />
      <div className="flex-1 min-h-0 overflow-y-auto pi-scrollbar py-0.5">
        {noMatches ? (
          <div className="px-2 py-1 text-base text-[var(--pi-muted)]">No matching files</div>
        ) : (
          renderNode(root, 0)
        )}
      </div>
    </div>
  );
}
