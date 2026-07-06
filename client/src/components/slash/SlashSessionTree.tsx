import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageSquare, ChevronRight, Sparkles, Scissors, Wrench, Terminal, Puzzle } from "lucide-react";
import { apiGet } from "../../lib/api";
import { formatUserMessagePreview } from "../../lib/prepareAttachments";
import { useSlashStore } from "../../stores/slashStore";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { PanelFilterBar } from "../common/PanelFilterBar";

interface TreeNode {
  id: string;
  role: "user" | "assistant" | "tool" | "bash" | "custom" | "summary" | "compaction";
  preview: string;
  label?: string;
  children?: TreeNode[];
}

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children ? findNode(node.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** True if this node or any descendant's preview/label matches the query. */
function nodeMatches(node: TreeNode, needle: string): boolean {
  if (node.preview.toLowerCase().includes(needle)) return true;
  if (node.label?.toLowerCase().includes(needle)) return true;
  return (node.children ?? []).some((child) => nodeMatches(child, needle));
}

/** Strips common markdown syntax for the flat-text list preview — raw "##"
 * and "**" markers read fine in a monospace terminal, but once rendered in
 * a proportional GUI row they just look broken. Visual-only; the actual
 * message content is untouched. */
function cleanPreview(text: string): string {
  return formatUserMessagePreview(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

function treeHasFork(nodes: TreeNode[]): boolean {
  return nodes.some((node) => {
    const children = node.children ?? [];
    return children.length > 1 || treeHasFork(children);
  });
}

/** Matches the CLI tree browser: active branch is listed first at a fork. */
function branchContainsLeaf(node: TreeNode, leafId: string | undefined): boolean {
  if (!leafId) return false;
  if (node.id === leafId) return true;
  return (node.children ?? []).some((child) => branchContainsLeaf(child, leafId));
}

function orderBranchChildren(children: TreeNode[], leafId: string | undefined): TreeNode[] {
  if (children.length <= 1) return children;
  const active: TreeNode[] = [];
  const rest: TreeNode[] = [];
  for (const child of children) {
    if (branchContainsLeaf(child, leafId)) active.push(child);
    else rest.push(child);
  }
  return [...active, ...rest];
}

/** Same indent rules as pi's CLI `TreeList.flattenTree()`. */
function childIndentFor(
  parentIndent: number,
  childCount: number,
  justBranched: boolean
): number {
  if (childCount > 1) return parentIndent + 1;
  if (justBranched && parentIndent > 0) return parentIndent + 1;
  return parentIndent;
}

interface FlatTreeEntry {
  id: string;
  parentId: string | null;
  isFork: boolean;
  hasChildren: boolean;
}

/** Same visibility rules as `renderNode` (search match, fork collapse) but
 * flattened to the order rows actually render in — the sequence the ↑/↓
 * keyboard cursor walks. */
function flattenVisible(
  nodes: TreeNode[],
  parentId: string | null,
  needle: string,
  collapsed: Set<string>,
  leafId: string | undefined,
  indent = 0,
  justBranched = false
): FlatTreeEntry[] {
  const out: FlatTreeEntry[] = [];
  for (const node of nodes) {
    if (needle && !nodeMatches(node, needle)) continue;
    const children = orderBranchChildren(node.children ?? [], leafId);
    const isFork = children.length > 1;
    const isCollapsed = isFork && collapsed.has(node.id) && !needle;
    out.push({ id: node.id, parentId, isFork, hasChildren: children.length > 0 });
    if (children.length > 0 && !isCollapsed) {
      const nextIndent = childIndentFor(indent, children.length, justBranched);
      const nextJustBranched = children.length > 1;
      out.push(
        ...flattenVisible(children, node.id, needle, collapsed, leafId, nextIndent, nextJustBranched)
      );
    }
  }
  return out;
}

interface SlashSessionTreeProps {
  sessionId: string;
  mode?: "tree" | "fork";
  onExecute: (command: string, args: Record<string, unknown>) => void;
}

const PANEL_ICON_SM = 14;
/** ~3 monospace cols per indent level — matches the CLI tree gutter step. */
const INDENT_PX = 14;

const CHOICE_BTN =
  "pi-panel-row w-full text-left px-2.5 py-2 text-[length:var(--pi-panel-font)] text-[var(--pi-text)] cursor-pointer outline-none border-none bg-transparent";

export function SlashSessionTree({
  sessionId,
  mode = "tree",
  onExecute,
}: SlashSessionTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentEntryId, setCurrentEntryId] = useState<string | undefined>();
  // Forks are expanded by default; this set tracks branches the user collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Navigating onto a node abandons everything past it — the pi SDK offers
  // to summarize what's being left behind before committing, same three-way
  // choice the CLI's tree browser shows.
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // ↑/↓ cursor over the fork/summarize choice buttons — same paradigm as
  // the node list itself, so Enter always means "the highlighted row".
  const [choiceIndex, setChoiceIndex] = useState(0);
  const lastResult = useSlashStore((s) => s.lastResult);
  const baselineResultRef = useRef(lastResult);

  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  // Keyboard cursor — separate from `currentEntryId` (the session's actual
  // position, shown bold/red) and `pendingTarget` (a click/Enter commits to
  // an action). ↑/↓ walk visible rows in order. ←/→ are reserved globally
  // for switching which composer toolbar panel is open (commands/tree/
  // history/files), so this tree never touches them — branches fold/unfold
  // by clicking the chevron instead.
  const [cursorId, setCursorId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // False while the keyboard cursor sits on the composer's toolbar row
  // (before ↓ has handed focus down into this list) — shared so ComposerBar
  // and this tree agree on who ↑/↓ belongs to right now.
  const toolbarKeyboardFocus = useComposerPanelStore((s) => s.toolbarKeyboardFocus);
  const setToolbarKeyboardFocus = useComposerPanelStore((s) => s.setToolbarKeyboardFocus);

  function toggleCollapse(nodeId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const flatVisible = useMemo(
    () => flattenVisible(tree, null, needle, collapsed, currentEntryId),
    [tree, needle, collapsed, currentEntryId]
  );

  // A purely linear session has no chevrons anywhere, so reserving the
  // fold-toggle column would just leave a dead gutter on every row.
  const hasFork = useMemo(() => treeHasFork(tree), [tree]);

  // Keep the cursor valid as the tree loads/filters/collapses — default it
  // to wherever the conversation actually sits right now.
  useEffect(() => {
    if (flatVisible.length === 0) { setCursorId(null); return; }
    if (cursorId && flatVisible.some((f) => f.id === cursorId)) return;
    const atCurrent = currentEntryId && flatVisible.some((f) => f.id === currentEntryId);
    setCursorId(atCurrent ? currentEntryId! : flatVisible[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisible]);

  useEffect(() => {
    if (!cursorId) return;
    rowRefs.current.get(cursorId)?.scrollIntoView({ block: "nearest" });
  }, [cursorId]);

  function moveCursor(delta: number) {
    if (flatVisible.length === 0) return;
    const idx = flatVisible.findIndex((f) => f.id === cursorId);
    const base = idx === -1 ? 0 : idx;
    const next = base + delta;
    if (next < 0) {
      // Walked up past the first row — hand focus back to the toolbar row.
      setToolbarKeyboardFocus(true);
      return;
    }
    setCursorId(flatVisible[(next + flatVisible.length) % flatVisible.length].id);
  }

  // The fork/summarize choice menu shown once a node is picked — same
  // list drives both the buttons below and their ↑/↓ + Enter navigation.
  // Declared before the keydown effect below since it's referenced there.
  const choices = useMemo<{ key: string; label: string; muted?: boolean; onSelect: () => void }[]>(() => {
    if (pendingTarget === null || customMode) return [];
    if (submitting) {
      return [{ key: "cancel", label: "Cancel", onSelect: () => onExecute("session.abortBranchSummary", {}) }];
    }
    if (mode === "fork") {
      const pendingNode = findNode(tree, pendingTarget);
      return [
        ...(pendingNode?.role === "user"
          ? [{ key: "before", label: "Fork before this message (edit & resend)", onSelect: () => submitFork("before") }]
          : []),
        { key: "at", label: "Fork at this point (clone)", onSelect: () => submitFork("at") },
        { key: "cancel", label: "Cancel", muted: true, onSelect: cancelChoice },
      ];
    }
    return [
      { key: "none", label: "No summary", onSelect: () => submitNavigate({ targetId: pendingTarget }) },
      { key: "summarize", label: "Summarize", onSelect: () => submitNavigate({ targetId: pendingTarget, summarize: true }) },
      { key: "custom", label: "Summarize with custom prompt", onSelect: () => setCustomMode(true) },
      { key: "cancel", label: "Cancel", muted: true, onSelect: cancelChoice },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget, submitting, customMode, mode, tree]);

  const safeChoiceIndex = Math.min(choiceIndex, Math.max(choices.length - 1, 0));

  // Fresh set of choices always starts the cursor back at the top row.
  useEffect(() => {
    setChoiceIndex(0);
  }, [pendingTarget, customMode, submitting]);

  // Scoped to this component's lifetime (mounted only while the tree panel
  // is open), same pattern as the composer's own history-panel shortcuts.
  // Disarmed while toolbarKeyboardFocus is true — at that point the ↑/↓
  // keys belong to the composer's toolbar row, not this list.
  useEffect(() => {
    if (toolbarKeyboardFocus) return;

    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inTextField = tag === "INPUT" || tag === "TEXTAREA";
      if (inTextField) return; // custom-prompt textarea (or the filter box) owns typing/caret

      if (pendingTarget !== null) {
        // Fork/summarize choice menu — same ↑/↓ + Enter cursor as the tree
        // itself, just walking the choice buttons instead of the nodes.
        if (choices.length === 0) return; // customMode's own inputs handle their own keys
        if (e.key === "ArrowDown") { e.preventDefault(); setChoiceIndex((i) => Math.min(i + 1, choices.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setChoiceIndex((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "Enter") { e.preventDefault(); choices[safeChoiceIndex]?.onSelect(); return; }
        return;
      }

      if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); return; }
      if (e.key === "Enter" && cursorId) { e.preventDefault(); handleNodeAction(cursorId); return; }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisible, cursorId, pendingTarget, toolbarKeyboardFocus, choices, safeChoiceIndex]);

  useEffect(() => {
    apiGet<{ tree: TreeNode[]; currentEntryId?: string }>(`/api/sessions/${sessionId}/tree`)
      .then((data) => {
        setTree(data.tree || []);
        setCurrentEntryId(data.currentEntryId);
      })
      .catch(console.error);
  }, [sessionId]);

  // Once the (possibly slow, LLM-backed) navigateTree call actually resolves,
  // close this panel ourselves — ChatPanel deliberately skips its normal
  // auto-close for summarized navigation so this loading state can show.
  useEffect(() => {
    if (!submitting) return;
    if (lastResult === baselineResultRef.current) return;
    const result = lastResult as { command?: string } | null;
    if (result?.command !== "session.navigateTree") return;
    setSubmitting(false);
    setPendingTarget(null);
    setCustomMode(false);
    setCustomText("");
    useSlashStore.getState().setActivePanel(null);
    useComposerPanelStore.getState().closePanel();
  }, [lastResult, submitting]);

  function handleNodeAction(nodeId: string) {
    if (pendingTarget !== null) return;
    setCursorId(nodeId);
    setPendingTarget(nodeId);
  }

  function submitNavigate(args: Record<string, unknown>) {
    baselineResultRef.current = lastResult;
    if (args.summarize) setSubmitting(true);
    onExecute("session.navigateTree", args);
  }

  function submitFork(position: "before" | "at") {
    if (!pendingTarget) return;
    onExecute("session.fork", { entryId: pendingTarget, position });
    setPendingTarget(null);
  }

  function cancelChoice() {
    setPendingTarget(null);
    setCustomMode(false);
    setCustomText("");
  }

  function renderNode(node: TreeNode, indent = 0, justBranched = false): ReactNode {
    if (needle && !nodeMatches(node, needle)) return null;

    const children = orderBranchChildren(node.children ?? [], currentEntryId);
    const isFork = children.length > 1;
    const isCollapsed = isFork && collapsed.has(node.id) && !needle;
    const isCurrent = node.id === currentEntryId;
    const isCursor = node.id === cursorId;
    const isOnActivePath = Boolean(currentEntryId && branchContainsLeaf(node, currentEntryId));
    const isStructural =
      node.role === "summary" ||
      node.role === "compaction" ||
      node.role === "tool" ||
      node.role === "bash" ||
      node.role === "custom";

    const roleIcon = (() => {
      switch (node.role) {
        case "summary":
          return <Sparkles size={PANEL_ICON_SM} />;
        case "compaction":
          return <Scissors size={PANEL_ICON_SM} />;
        case "tool":
          return <Wrench size={PANEL_ICON_SM} />;
        case "bash":
          return <Terminal size={PANEL_ICON_SM} />;
        case "custom":
          return <Puzzle size={PANEL_ICON_SM} />;
        default:
          return <MessageSquare size={PANEL_ICON_SM} />;
      }
    })();

    const rolePrefix =
      node.role === "summary"
        ? "Summary: "
        : node.role === "compaction"
          ? "Compacted: "
          : "";

    const nextIndent = childIndentFor(indent, children.length, justBranched);
    const nextJustBranched = children.length > 1;

    return (
      <div key={node.id}>
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(node.id, el);
            else rowRefs.current.delete(node.id);
          }}
          className={`pi-panel-row flex items-center gap-2 py-1${isCursor ? " pi-panel-row--selected" : ""}`}
          style={{ paddingLeft: `${indent * INDENT_PX}px` }}
        >
          {isFork ? (
            <button
              type="button"
              onClick={() => toggleCollapse(node.id)}
              className={`flex h-6 w-6 shrink-0 items-center justify-center cursor-pointer ${
                isCurrent ? "text-[var(--pi-theme)]" : "text-[var(--pi-muted)] hover:text-[var(--pi-theme)]"
              }`}
              aria-label={isCollapsed ? `Expand ${children.length} branches` : "Collapse branches"}
            >
              <ChevronRight
                size={PANEL_ICON_SM}
                className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              />
            </button>
          ) : (
            <span className={`h-6 shrink-0 ${hasFork ? "w-6" : "w-1"}`} aria-hidden="true" />
          )}
          <span
            className={`w-1.5 shrink-0 select-none ${isOnActivePath ? "text-[var(--pi-theme)]" : "text-transparent"}`}
            aria-hidden="true"
          >
            •
          </span>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center ${
              node.role === "user"
                ? "bg-[var(--pi-line)]"
                : node.role === "assistant"
                  ? "bg-[var(--pi-accent-soft)]"
                  : "bg-[var(--pi-panel-subtle)]"
            } text-[var(--pi-text)]`}
          >
            {roleIcon}
          </span>
          <button
            type="button"
            onClick={() => handleNodeAction(node.id)}
            title={cleanPreview(node.preview)}
            className={`min-w-0 flex-1 truncate text-left text-[length:var(--pi-panel-font)] cursor-pointer ${
              isStructural ? "italic" : ""
            }${isCursor ? "" : isStructural ? " text-[var(--pi-muted)]" : " text-[var(--pi-text)]"}`}
          >
            {node.label && (
              <span className="mr-1.5 not-italic rounded bg-[var(--pi-accent-soft)] px-1.5 py-0.5 font-mono text-[length:var(--pi-panel-font-meta)] uppercase tracking-wide text-[var(--pi-theme)]">
                {node.label}
              </span>
            )}
            {rolePrefix}
            {cleanPreview(node.preview)}
          </button>
          {isFork && (
            <span className="shrink-0 font-mono text-[length:var(--pi-panel-font-meta)] uppercase tracking-wide text-[var(--pi-muted)]">
              {children.length} branches
            </span>
          )}
        </div>
        {children.length > 0 && !isCollapsed &&
          children.map((child, index) => (
            <div key={child.id}>
              {isFork && index > 0 && (
                <div
                  className="border-t border-dashed border-[var(--pi-line)]"
                  style={{ marginLeft: `${nextIndent * INDENT_PX}px` }}
                  aria-hidden="true"
                />
              )}
              {renderNode(child, nextIndent, nextJustBranched)}
            </div>
          ))
        }
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PanelFilterBar value={query} onChange={setQuery} />

      {pendingTarget !== null && (
        <div className="shrink-0 border-y border-[var(--pi-line)] bg-[var(--pi-panel-subtle)] px-1 py-1.5">
          {submitting ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-[length:var(--pi-panel-font-meta)] text-[var(--pi-muted)] font-mono">Summarizing branch…</span>
              <button
                type="button"
                onClick={() => onExecute("session.abortBranchSummary", {})}
                className="shrink-0 text-[length:var(--pi-panel-font-meta)] text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer outline-none"
              >
                Cancel
              </button>
            </div>
          ) : customMode ? (
            <div className="flex flex-col gap-1.5 px-2 py-1">
              <textarea
                autoFocus
                rows={2}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Custom summarization instructions…"
                className="w-full resize-none border border-[var(--pi-line)] bg-transparent px-2 py-1.5 text-[length:var(--pi-panel-font)] text-[var(--pi-text)] outline-none placeholder:text-[var(--pi-muted)]"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="text-[length:var(--pi-panel-font-meta)] text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer outline-none"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => submitNavigate({ targetId: pendingTarget, summarize: true, customInstructions: customText })}
                  className="text-[length:var(--pi-panel-font-meta)] text-[var(--pi-theme)] cursor-pointer outline-none"
                >
                  Summarize
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="px-2.5 pt-1 pb-1.5 text-[length:var(--pi-panel-font-meta)] uppercase tracking-wider text-[var(--pi-muted)]">
                {mode === "fork" ? "Fork session" : "Summarize branch?"}
              </span>
              {/* Same ↑/↓ + Enter cursor as the node list above — the
                  highlighted row is whichever choice Enter will pick. */}
              {choices.map((choice, index) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={choice.onSelect}
                  onMouseEnter={() => setChoiceIndex(index)}
                  className={`${CHOICE_BTN}${index === safeChoiceIndex ? " pi-panel-row--selected" : ""}${
                    choice.muted && index !== safeChoiceIndex ? " text-[var(--pi-muted)]" : ""
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pi-scrollbar px-1 py-0.5">
        {tree.length === 0 ? null : needle && !tree.some((node) => nodeMatches(node, needle)) ? null : (
          tree.map((node) => renderNode(node))
        )}
      </div>
    </div>
  );
}
