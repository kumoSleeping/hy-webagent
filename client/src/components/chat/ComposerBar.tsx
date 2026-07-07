import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { Command, SquarePen, GitBranch, History, FolderOpen, Cpu, Plus, Send, X, UserRound } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useConnectionState } from "../../context/useChatConnection";
import { useSlashStore, selectFilteredCommands } from "../../stores/slashStore";
import type { SlashCommand } from "../../stores/slashStore";
import { SlashCommandListItem } from "../slash/SlashCommandListItem";
import {
  canSubmitBareSlash,
  getBareSlashId,
  getBareSlashArgText,
  shouldPickSlashFromList,
} from "../../lib/slashSubmit";
import {
  filterSessionsByQuery,
  filterVisibleSessions,
  indexOfActiveSession,
} from "../../lib/historySessions";
import { useComposerFocusStore } from "../../stores/composerFocusStore";
import { useComposerPanelStore, type ComposerPanelKind } from "../../stores/composerPanelStore";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { FileTree } from "../files/FileTree";
import { PanelFilterBar } from "../common/PanelFilterBar";
import { AccountPanel } from "../platform/AccountPanel";
import { useImeComposition } from "../../hooks/useImeComposition";
import { useFittedToolbarItems } from "../../hooks/useFittedToolbarItems";
import { prepareSingleAttachment, mergePreparedAttachments, filesFromClipboard, isSupportedAttachmentFile, normalizePastedFile, formatUserMessagePreview } from "../../lib/prepareAttachments";
import type { PreparedAttachmentItem, PromptImage } from "../../lib/prepareAttachments";
import { useNotificationStore } from "../../stores/notificationStore";
import type { FileEntry } from "../../types";
import {
  isElevatedPanel,
  MOBILE_TOOLBAR_BTN_MAX_PX,
  panelToolbarIndex,
  toolbarBtnWidthPx,
  type ToolbarItemDef,
} from "../../lib/composerLayout";
import {
  insertCompressedMarker,
  removeMarker,
  findMarkerBounds,
  createCompressedMarker,
} from "../../lib/compressedText";

interface ComposerBarProps {
  disabled?: boolean;
  isStreaming?: boolean;
  onSend: (text: string, images?: PromptImage[], displayText?: string) => void;
  onAbort?: () => void;
  /** Insert a message into the conversation while the agent is still
   * running — delivered as a steering message (applied once the current
   * turn's tool calls finish, before the next model call). */
  onSteer?: (text: string) => void;
  /** Steering/follow-up messages currently queued behind the active turn,
   * oldest first — these haven't actually reached the model yet, so each
   * gets its own small numbered slot next to the working indicator instead
   * of appearing in the transcript. */
  queuedSteering?: string[];
  queuedFollowUp?: string[];
  /** Pulls one specific queued message back into the composer for editing
   * — everything else in the queue is re-queued in its original order, and
   * the edited one lands at the back (newest) once resent. */
  onEditQueued?: (source: "steering" | "followUp", index: number) => void;
  onSlash?: (command: string) => void;
  onNewChat: () => void;
  onFileClick: (entry: FileEntry) => void;
  /** Rendered UI for the currently active slash command (model selector,
   * settings, etc.) — shown in place of the command list once a command
   * has been picked. Lives in the same right-aligned popup as history/files. */
  commandsContent?: ReactNode;
  /** Model picker — direct toolbar toggle, same popup as history/files. */
  modelContent?: ReactNode;
  isMobileLayout?: boolean;
}

const MIN_ROWS = 1;
const MAX_ROWS = 8;
const COMPRESSED_PASTE_THRESHOLD = 300;

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
  status: "processing" | "ready" | "error";
  prepared?: PreparedAttachmentItem;
  error?: string;
}

function toolbarIcon(item: ToolbarItemDef) {
  switch (item.id) {
    case "commands":
      return <Command strokeWidth={2} aria-hidden="true" />;
    case "model":
      return <Cpu strokeWidth={2} aria-hidden="true" />;
    case "tree":
      return <GitBranch strokeWidth={2} aria-hidden="true" />;
    case "history":
      return <History strokeWidth={2} aria-hidden="true" />;
    case "files":
      return <FolderOpen strokeWidth={2} aria-hidden="true" />;
    case "account":
      return <UserRound strokeWidth={2} aria-hidden="true" />;
    case "new-chat":
      return <SquarePen strokeWidth={2} aria-hidden="true" />;
  }
}

function toolbarTitle(item: ToolbarItemDef): string {
  switch (item.id) {
    case "commands":
      return "Commands";
    case "model":
      return "Model";
    case "tree":
      return "Tree";
    case "history":
      return "History";
    case "files":
      return "Files";
    case "account":
      return "Account & budget";
    case "new-chat":
      return "New chat (Enter)";
  }
}

function toolbarAriaLabel(item: ToolbarItemDef): string {
  switch (item.id) {
    case "commands":
      return "Toggle commands";
    case "model":
      return "Toggle model selector";
    case "tree":
      return "Toggle tree";
    case "history":
      return "Toggle history";
    case "files":
      return "Toggle files";
    case "account":
      return "Toggle account panel";
    case "new-chat":
      return "New chat";
  }
}

function getSlashParts(value: string): { id: string; argText: string } | null {
  const id = getBareSlashId(value);
  if (!id) return null;
  return { id, argText: getBareSlashArgText(value) };
}

function findSlashCommand(id: string): SlashCommand | undefined {
  const lower = id.toLowerCase();
  const all = [...useSlashStore.getState().commands, ...useSlashStore.getState().dynamicCommands];
  return all.find((c) => c.id.toLowerCase() === lower || c.label.toLowerCase() === lower);
}

function shouldSendSlashOnEnter(value: string): boolean {
  return canSubmitBareSlash(value, (id) => findSlashCommand(id));
}

export function ComposerBar({
  disabled = false,
  isStreaming = false,
  onSend,
  onAbort,
  onSteer,
  queuedSteering = [],
  queuedFollowUp = [],
  onEditQueued,
  onSlash,
  onNewChat,
  onFileClick,
  commandsContent,
  modelContent,
  isMobileLayout = false,
}: ComposerBarProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const connectionState = useConnectionState();
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const toolbarItems = useFittedToolbarItems(isMobileLayout, shellRef);
  const btnWidthPx = useMemo(() => {
    const raw = toolbarBtnWidthPx();
    return Math.min(raw, MOBILE_TOOLBAR_BTN_MAX_PX);
  }, []);
  const newChatToolbarIndex = toolbarItems.findIndex((item) => item.id === "new-chat");
  const panelToolbarIdx = (kind: Exclude<ComposerPanelKind, null>) =>
    panelToolbarIndex(kind, toolbarItems);
  const [text, setText] = useState("");
  /** ↑/↓ in the command list (panel body above the toolbar row). */
  const [commandListFocus, setCommandListFocus] = useState(false);
  /** ↑/↓ cursor in the history list (mirrors commandListFocus/selectedIndex,
   * generalized since history has no dedicated store). */
  const [historySelectedIndex, setHistorySelectedIndex] = useState(0);
  const [historyQuery, setHistoryQuery] = useState("");
  const historyRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { imeProps, isComposing, composingRef } = useImeComposition((value) => {
    setText(value);
  });
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const argsLockRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const focusTick = useComposerFocusStore((s) => s.focusTick);
  const requestFocus = useComposerFocusStore((s) => s.requestFocus);
  const pendingText = useComposerFocusStore((s) => s.pendingText);
  const composerDraft = useExtensionUiStore((s) => s.composerDraft);

  const panel = useComposerPanelStore((s) => s.panel);
  const togglePanel = useComposerPanelStore((s) => s.togglePanel);
  const toggleFilesPanel = useComposerPanelStore((s) => s.toggleFilesPanel);
  const setPanel = useComposerPanelStore((s) => s.setPanel);
  const closePanel = useComposerPanelStore((s) => s.closePanel);
  const toolbarIndex = useComposerPanelStore((s) => s.toolbarIndex);
  const setToolbarIndex = useComposerPanelStore((s) => s.setToolbarIndex);
  const toolbarKeyboardFocus = useComposerPanelStore((s) => s.toolbarKeyboardFocus);
  const setToolbarKeyboardFocus = useComposerPanelStore((s) => s.setToolbarKeyboardFocus);
  const { sessions, activePiSessionId, activateSession } = useSessionStore();
  const activePanel = useSlashStore((s) => s.activePanel);
  const setActivePanel = useSlashStore((s) => s.setActivePanel);
  const showCommandList = panel === "commands" && activePanel === null;

  const visibleSessions = useMemo(
    () => filterVisibleSessions(sessions, activePiSessionId),
    [sessions, activePiSessionId]
  );
  const filteredHistorySessions = useMemo(
    () => filterSessionsByQuery(visibleSessions, historyQuery),
    [visibleSessions, historyQuery]
  );

  function focusHistoryRow(index: number) {
    setHistorySelectedIndex(index);
  }

  async function handleSessionClick(piSessionId: string) {
    closePanel();
    blurComposerInput();
    await activateSession(piSessionId);
  }

  function handleNewChatClick() {
    closePanel();
    setToolbarIndex(newChatToolbarIndex);
    setToolbarKeyboardFocus(false);
    setCommandListFocus(false);
    onNewChat();
    requestFocus();
  }

  function handleSlashButtonClick() {
    const opening = panel !== "commands";
    togglePanel("commands");
    if (opening) {
      setToolbarIndex(panelToolbarIdx("commands"));
      setActivePanel(null);
      focusCommandList();
      // Stale slash query (e.g. "/nomatch" from a prior pick) would leave
      // the list empty even though the box is blank — always resync.
    }
    blurComposerInput();
  }

  function handleToolbarPointerDown(e: React.PointerEvent) {
    // Keep toolbar taps from pulling focus (and the IME) back into the composer.
    e.preventDefault();
    blurComposerInput();
  }

  function handleFilesClick() {
    setToolbarKeyboardFocus(false);
    setCommandListFocus(false);
    if (isMobileLayout) {
      togglePanel("files");
    } else {
      toggleFilesPanel();
    }
    blurComposerInput();
  }

  function handleToolbarItemClick(item: ToolbarItemDef) {
    if (item.id === "new-chat") {
      handleNewChatClick();
      return;
    }
    if (item.id === "commands") {
      handleSlashButtonClick();
      return;
    }
    if (item.id === "files") {
      handleFilesClick();
      return;
    }
    if (item.panel) handleToolbarClick(item.panel);
  }

  function handleToolbarClick(panelKind: Exclude<ComposerPanelKind, null>) {
    setToolbarKeyboardFocus(false);
    setCommandListFocus(false);
    if (panelKind === "history") {
      void useSessionStore.getState().fetchSessions();
    }
    togglePanel(panelKind);
    blurComposerInput();
  }

  const query = useSlashStore((s) => s.query);
  const selectedIndex = useSlashStore((s) => s.selectedIndex);
  const closeMenu = useSlashStore((s) => s.close);
  const setQuery = useSlashStore((s) => s.setQuery);
  const selectNext = useSlashStore((s) => s.selectNext);
  const selectPrev = useSlashStore((s) => s.selectPrev);
  const selectIndex = useSlashStore((s) => s.selectIndex);
  const filtered = useSlashStore(useShallow(selectFilteredCommands));
  const systemCommands = useSlashStore((s) => s.commands);

  function applyPendingCaret(options?: { focus?: boolean }) {
    if (pendingCaretRef.current === null) return;
    const ta = taRef.current;
    if (!ta) return;
    const pos = Math.min(pendingCaretRef.current, ta.value.length);
    pendingCaretRef.current = null;
    const shouldFocus = options?.focus ?? true;
    if (shouldFocus) ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos);
  }

  function blurComposerInput() {
    taRef.current?.blur();
  }

  /** Move caret into the composer when the user is about to type (slash args, etc.). */
  function focusComposerForTyping(nextText?: string) {
    focusComposerAtEnd(nextText);
    applyPendingCaret({ focus: true });
  }

  /** After picking a slash command, place the caret at end-of-line once text commits. */
  function focusComposerAtEnd(nextText?: string) {
    pendingCaretRef.current =
      nextText !== undefined ? nextText.length : (taRef.current?.value.length ?? null);
  }

  useLayoutEffect(() => {
    applyPendingCaret();
  }, [text, focusTick]);

  function focusCommandList() {
    setToolbarKeyboardFocus(false);
    setCommandListFocus(true);
    if (text.startsWith("/")) {
      if (query !== text) setQuery(text);
    } else {
      if (query !== "") setQuery("");
      else selectIndex(0);
    }
  }

  const prevPanelRef = useRef<ComposerPanelKind | null>(null);
  useEffect(() => {
    const prev = prevPanelRef.current;
    prevPanelRef.current = panel;
    if (panel === "commands" && prev !== "commands" && activePanel === null) {
      focusCommandList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, activePanel]);

  useEffect(() => {
    if (toolbarIndex >= toolbarItems.length) {
      setToolbarIndex(Math.max(0, toolbarItems.length - 1));
    }
  }, [toolbarIndex, toolbarItems.length, setToolbarIndex]);

  // Mouse-opened panels: keep toolbarIndex aligned with the active tab.
  useEffect(() => {
    if (panel) setToolbarIndex(panelToolbarIdx(panel));
  }, [panel]);

  // Closing the commands popup (toggle, backdrop click, ESC, picking a
  // history/files panel instead) always drops back to the command list,
  // never leaves a stale sub-view armed for next time.
  useEffect(() => {
    if (panel !== "commands" && activePanel !== null) setActivePanel(null);
  }, [panel, activePanel, setActivePanel]);

  useEffect(() => {
    if (panel === "history") return;
    setHistoryQuery("");
  }, [panel]);

  // Snap to the active session only when entering the list or changing the filter —
  // not when the session list refreshes in the background (that was resetting ↑/↓).
  useEffect(() => {
    if (panel !== "history" || toolbarKeyboardFocus) return;
    const idx = indexOfActiveSession(filteredHistorySessions, activePiSessionId);
    focusHistoryRow(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, toolbarKeyboardFocus, historyQuery]);

  useEffect(() => {
    if (filteredHistorySessions.length === 0) {
      setHistorySelectedIndex(0);
      return;
    }
    if (historySelectedIndex >= filteredHistorySessions.length) {
      setHistorySelectedIndex(filteredHistorySessions.length - 1);
    }
  }, [filteredHistorySessions.length, historySelectedIndex]);

  useEffect(() => {
    historyRowRefs.current[historySelectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [historySelectedIndex]);

  const resizeComposerInput = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const padTop = parseFloat(getComputedStyle(ta).paddingTop) || 0;
    const padBot = parseFloat(getComputedStyle(ta).paddingBottom) || 0;
    const maxH = lineHeight * MAX_ROWS + padTop + padBot;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
    ta.style.overflowX = "hidden";
    ta.style.overflowY = ta.scrollHeight > maxH + 1 ? "auto" : "hidden";
  }, []);

  // Auto-resize: grow with content up to MAX_ROWS, then scroll internally.
  // Keep resizing during IME composition — system dictation grows scrollHeight
  // while composing; skipping left the box stuck at one line.
  useLayoutEffect(() => {
    resizeComposerInput();
  }, [text, resizeComposerInput]);

  // Sync the commands popup with composer text — typing "/" opens the same
  // right-aligned panel the commands button does; finishing up a command's
  // arguments (or erasing back out of a slash command) closes it again.
  // Deliberately keyed on `text` alone (panel/query/etc. are read fresh from
  // the latest render via closure): the button can also open this same
  // "commands" panel with an empty box, and that must NOT be immediately
  // closed just because this effect re-runs when `panel` itself changes.
  const prevTextRef = useRef(text);
  useEffect(() => {
    const prevText = prevTextRef.current;
    prevTextRef.current = text;
    const lockedId = argsLockRef.current;
    const parts = getSlashParts(text);
    if (text.startsWith("/")) {
      // Keep the list closed while the user is typing arguments for a selected command.
      if (parts?.argText || (lockedId && text.startsWith(`/${lockedId} `))) {
        if (panel === "commands") closePanel();
        return;
      }
      if (panel !== "commands") {
        setPanel("commands");
        setToolbarIndex(panelToolbarIdx("commands"));
      }
      focusCommandList();
    } else if (prevText.startsWith("/")) {
      // Only auto-close when the user actually erased a slash command —
      // never when the box was already empty (e.g. opened via the button),
      // and not when a panel sub-view (model, resume, …) just cleared input.
      argsLockRef.current = null;
      const armedPanel = useSlashStore.getState().activePanel;
      if (panel === "commands" && !armedPanel) closePanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // External focus requests (New Chat, session switch, etc.) — a pending
  // draft (e.g. from navigating the tree back to a user message) gets
  // dropped into the box before focus lands.
  useEffect(() => {
    if (focusTick === 0) return;
    const draft = pendingText ?? composerDraft;
    if (draft != null) {
      setText(draft);
      useComposerFocusStore.setState({ pendingText: null });
      useExtensionUiStore.getState().setComposerDraft(null);
      focusComposerAtEnd(draft);
      return;
    }
    focusComposerAtEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  // Global "/" opens slash menu when composer is empty (even without focus).
  useEffect(() => {
    function onGlobalKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (text.length > 0) return;

      const target = e.target as HTMLElement | null;
      if (target === taRef.current) return;

      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      e.preventDefault();
      setText("/");
      setPanel("commands");
      setToolbarIndex(panelToolbarIdx("commands"));
      focusCommandList();
      focusComposerAtEnd("/");
    }

    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, [text, setPanel]);

  // Composer-wide keyboard navigation. ←/→ always switch *which* toolbar
  // button (commands/tree/history/files/new-chat) is focused, live-
  // opening that panel as the cursor lands on it. ↑/↓ move *within*
  // whatever's currently open: the first ↓ off the toolbar row hands focus
  // into that panel's list, and ↑ at the top of a list hands it back.
  // Tree/files own their own ↑/↓ internally (via toolbarKeyboardFocus in
  // the shared store) once handed the list; commands/history are simple
  // enough to live right here. A document-level capture listener (rather
  // than the textarea's onKeyDown) is required because clicking a toolbar
  // button moves real DOM focus off the textarea.
  useEffect(() => {
    function onNavKeyDown(e: globalThis.KeyboardEvent) {
      const key = e.key;
      if (
        key !== "ArrowLeft" && key !== "ArrowRight" &&
        key !== "ArrowUp" && key !== "ArrowDown" &&
        key !== "Enter" && key !== "Escape"
      ) return;

      const target = e.target as HTMLElement | null;
      const isMainTextarea = target === taRef.current;
      const tag = target?.tagName;
      const isForeignField = !isMainTextarea && (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true);
      if (isForeignField) return;

      // While the composer IME is open, leave every key to the textarea —
      // capture listeners must not preventDefault or hijack arrows/Enter.
      if (isMainTextarea && composingRef.current && key !== "Escape") return;

      if (key === "Escape") {
        if (panel !== null || toolbarKeyboardFocus) {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          setToolbarKeyboardFocus(false);
          setCommandListFocus(false);
        }
        return;
      }

      if (key === "ArrowLeft" || key === "ArrowRight") {
        // Never hijacks caret movement while actually typing a message —
        // only kicks in once the box is empty or we're already navigating.
        if (isMainTextarea && text.length > 0 && !toolbarKeyboardFocus && panel === null) return;
        e.preventDefault();
        e.stopPropagation();
        const len = toolbarItems.length;
        const base = toolbarKeyboardFocus ? toolbarIndex : panel ? panelToolbarIdx(panel) : key === "ArrowRight" ? -1 : 0;
        const next = key === "ArrowRight" ? (base + 1 + len) % len : (base - 1 + len) % len;
        setToolbarIndex(next);
        const item = toolbarItems[next];
        if (item.panel === "commands") {
          focusCommandList();
        } else {
          setToolbarKeyboardFocus(true);
          setCommandListFocus(false);
        }
        if (item.panel) setPanel(item.panel);
        else closePanel();
        return;
      }

      if (key === "ArrowDown" && toolbarKeyboardFocus) {
        if (!panel) return;
        e.preventDefault();
        e.stopPropagation();
        setToolbarKeyboardFocus(false);
        if (panel === "commands") setCommandListFocus(true);
        return;
      }
      if (key === "ArrowUp" && toolbarKeyboardFocus) return; // nothing above the toolbar row

      if (key === "Enter") {
        if (toolbarKeyboardFocus && toolbarItems[toolbarIndex]?.enterToActivate) {
          e.preventDefault();
          e.stopPropagation();
          handleNewChatClick();
          return;
        }

        if (panel === "commands" && showCommandList && !toolbarKeyboardFocus) {
          if (filtered.length > 0) {
            if (shouldPickSlashFromList(text, filtered) || !canSubmitOnEnter(text)) {
              e.preventDefault();
              e.stopPropagation();
              const cmd = filtered[selectedIndex];
              if (cmd) activateCommand(cmd);
              return;
            }
          }
          if (canSubmitOnEnter(text)) {
            e.preventDefault();
            e.stopPropagation();
            handleSend();
            return;
          }
        }
      }

      if (panel === "commands" && showCommandList && !toolbarKeyboardFocus) {
        if (key === "ArrowDown" && filtered.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          setCommandListFocus(true);
          selectNext();
          return;
        }
        if (key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          if (selectedIndex === 0) {
            setCommandListFocus(false);
            setToolbarKeyboardFocus(true);
            return;
          }
          setCommandListFocus(true);
          selectPrev();
          return;
        }
      }

      if (panel === "history" && !toolbarKeyboardFocus) {
        if (filteredHistorySessions.length === 0) return;
        if (key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          setHistorySelectedIndex((i) =>
            Math.min(i + 1, filteredHistorySessions.length - 1)
          );
          return;
        }
        if (key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          if (historySelectedIndex === 0) {
            setToolbarKeyboardFocus(true);
            return;
          }
          setHistorySelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const s = filteredHistorySessions[historySelectedIndex];
          if (s) void handleSessionClick(s.id);
          return;
        }
      }
    }

    document.addEventListener("keydown", onNavKeyDown, true);
    return () => document.removeEventListener("keydown", onNavKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    text, panel, toolbarIndex, toolbarKeyboardFocus, showCommandList, filtered, selectedIndex,
    historySelectedIndex, filteredHistorySessions,
  ]);

  // Scroll keyboard-selected item into view.
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
  }, [showCommandList]);

  useEffect(() => {
  }, [query, filtered.length]);

  useEffect(() => {
    return () => {
      pendingAttachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearPendingAttachments() {
    setPendingAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((entry) => entry.id !== id);
    });
  }

  function attachmentsProcessing() {
    return pendingAttachments.some((item) => item.status === "processing");
  }

  function readyAttachments() {
    return pendingAttachments.filter((item) => item.status === "ready" && item.prepared);
  }

  async function processAttachmentEntry(entry: PendingAttachment) {
    try {
      const prepared = await prepareSingleAttachment(entry.file);
      setPendingAttachments((prev) =>
        prev.map((item) =>
          item.id === entry.id ? { ...item, status: "ready", prepared, error: undefined } : item
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare attachment";
      setPendingAttachments((prev) =>
        prev.map((item) =>
          item.id === entry.id ? { ...item, status: "error", error: message } : item
        )
      );
      useNotificationStore.getState().notify(message, "info");
    }
  }

  function ingestFiles(files: File[]) {
    const supported = files
      .map((file, index) => normalizePastedFile(file, index))
      .filter(isSupportedAttachmentFile);
    if (!supported.length) {
      if (files.length > 0) {
        useNotificationStore.getState().notify("Only images and text files can be attached", "info");
      }
      return;
    }

    const entries: PendingAttachment[] = supported.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      status: "processing",
    }));
    setPendingAttachments((prev) => [...prev, ...entries]);
    entries.forEach((entry) => {
      void processAttachmentEntry(entry);
    });
  }

  function restoreComposerInputAfterPicker() {
    const ta = taRef.current;
    if (ta?.readOnly) ta.readOnly = false;
  }

  function openAttachmentPicker() {
    const ta = taRef.current;
    const input = fileInputRef.current;
    if (!input) return;

    // iOS refocuses the last editable field when the native picker closes —
    // readOnly + blur prevents the keyboard from flashing up on attach tap.
    if (ta) ta.readOnly = true;
    blurComposerInput();

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener("focus", restore);
      restoreComposerInputAfterPicker();
    };
    window.addEventListener("focus", restore, { once: true });

    requestAnimationFrame(() => {
      input.click();
    });
  }

  function handleAttachClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openAttachmentPicker();
  }

  function handleAttachmentInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    restoreComposerInputAfterPicker();
    if (!selected.length) return;
    ingestFiles(selected);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled || isStreaming || isConnecting) return;
    const pastedFiles = filesFromClipboard(e.clipboardData).filter(isSupportedAttachmentFile);
    if (pastedFiles.length) {
      e.preventDefault();
      ingestFiles(pastedFiles);
      return;
    }

    const pastedText = e.clipboardData?.getData("text") ?? "";
    if (pastedText.length > COMPRESSED_PASTE_THRESHOLD) {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) {
        setText((prev) => prev + createCompressedMarker(pastedText.length));
        return;
      }
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const { text: nextText, position } = insertCompressedMarker(text, start, end, pastedText.length);
      setText(nextText);
      pendingCaretRef.current = position;
      applyPendingCaret({ focus: true });
    }
  }

  function canSendNow(value: string): boolean {
    if (disabled || attachmentsProcessing()) return false;
    const readyCount = readyAttachments().length;
    if (readyCount > 0) return !value.startsWith("/");
    return !!value.trim();
  }

  function handleSend() {
    if (!canSendNow(text)) return;

    if (isStreaming) {
      if (text.startsWith("/") || pendingAttachments.length > 0) return;
      onSteer?.(text.trim());
      setText("");
      argsLockRef.current = null;
      closeMenu();
      closePanel();
      setToolbarKeyboardFocus(false);
      setCommandListFocus(false);
      blurComposerInput();
      return;
    }

    const preparedItems = readyAttachments().map((item) => item.prepared!);
    const merged = mergePreparedAttachments(preparedItems);
    let finalText = text.trim();
    if (merged.textAppend) {
      finalText = finalText
        ? `${finalText}\n\n${merged.textAppend.trim()}`
        : merged.textAppend.trim();
    }
    const images = merged.images.length > 0 ? merged.images : undefined;
    if (!finalText && !images?.length) return;

    onSend(finalText, images, text.trim());
    setText("");
    clearPendingAttachments();
    argsLockRef.current = null;
    closeMenu();
    closePanel();
    setToolbarKeyboardFocus(false);
    setCommandListFocus(false);
    blurComposerInput();
  }

  function canSubmitOnEnter(value: string): boolean {
    if (!canSendNow(value)) return false;
    if (isStreaming) return !value.startsWith("/") && pendingAttachments.length === 0;
    if (!value.startsWith("/")) return true;
    return shouldSendSlashOnEnter(value);
  }

  function activateCommand(command: SlashCommand) {
    if (command.kind === "panel") {
      closeMenu();
      if (command.id === "model") {
        setPanel("model");
        setToolbarIndex(panelToolbarIdx("model"));
      } else {
        onSlash?.(command.id);
        setPanel("commands");
        setToolbarIndex(panelToolbarIdx("commands"));
      }
      setText("");
      blurComposerInput();
    } else if (command.kind === "args") {
      const nextText = `/${command.id} `;
      argsLockRef.current = command.id;
      setText(nextText);
      closeMenu();
      focusComposerForTyping(nextText);
    } else if (command.kind === "prompt" || command.kind === "skill" || command.kind === "extension") {
      closeMenu();
      onSend(`/${command.label}`);
      setText("");
    } else {
      const nextText = `/${command.id}`;
      closeMenu();
      onSend(nextText);
      setText("");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // ←/→/↑/↓/Enter-on-toolbar/Escape are all handled by the document-level
    // navigation listener above (it runs first and stops propagation for
    // anything it claims) — this only ever sees a plain Enter-to-send.

    // Backspace/Delete on a compressed marker removes the whole marker atomically.
    if ((e.key === "Backspace" || e.key === "Delete") && !e.shiftKey && !isComposing(e)) {
      const ta = taRef.current;
      if (!ta) return;
      const selStart = ta.selectionStart ?? 0;
      const selEnd = ta.selectionEnd ?? 0;
      const bounds = findMarkerBounds(text, selStart) ?? findMarkerBounds(text, selEnd);
      if (bounds) {
        e.preventDefault();
        const removed = removeMarker(text, selStart);
        if (removed) {
          setText(removed.text);
          pendingCaretRef.current = removed.position;
          applyPendingCaret({ focus: true });
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (isComposing(e)) {
        // Let the IME consume Enter (candidate pick) — never preventDefault here.
        return;
      }

      if (text.startsWith("/")) {
        const parts = getSlashParts(text);
        if (parts && !parts.argText) {
          const cmd = findSlashCommand(parts.id);
          if (cmd?.kind === "panel") {
            e.preventDefault();
            activateCommand(cmd);
            return;
          }
        }
      }

      if (panel === "commands" && showCommandList && !toolbarKeyboardFocus && filtered.length > 0) {
        if (shouldPickSlashFromList(text, filtered) || !canSubmitOnEnter(text)) {
          e.preventDefault();
          const cmd = filtered[selectedIndex];
          if (cmd) activateCommand(cmd);
          return;
        }
      }

      if (canSubmitOnEnter(text)) {
        e.preventDefault();
        handleSend();
      } else {
        e.preventDefault();
      }
    }
  }

  function focusInput(e: React.MouseEvent) {
    if (panel !== null) return;
    // When clicking directly on the textarea, let the browser place the
    // caret naturally — don't override it by forcing cursor to end.
    if (e.target === taRef.current) return;
    focusComposerForTyping();
  }

  const commandListContent = (
    <div className="pi-composer-cmd-list">
      {filtered.length === 0 ? (
        <div className="pi-composer-cmd-empty">No matching commands</div>
      ) : (
        filtered.map((cmd, index) => (
          <SlashCommandListItem
            key={cmd.id}
            command={cmd}
            systemCommands={systemCommands}
            selected={
              showCommandList && index === selectedIndex && (commandListFocus || !toolbarKeyboardFocus)
            }
            itemRef={(el) => { itemRefs.current[index] = el; }}
            onMouseDown={(e) => e.preventDefault()}
            onActivate={() => activateCommand(cmd)}
          />
        ))
      )}
    </div>
  );

  const historyContent = (
    <>
      {filteredHistorySessions.length === 0 ? (
        <div className="pi-hist-empty">
          {visibleSessions.length === 0 ? "No sessions yet" : "No matching sessions"}
        </div>
      ) : (
        filteredHistorySessions.map((s, i) => {
          const isCursor = panel === "history" && !toolbarKeyboardFocus && i === historySelectedIndex;
          return (
            <div
              key={s.id}
              ref={(el) => { historyRowRefs.current[i] = el; }}
              className={`pi-panel-row pi-hist-row${isCursor ? " pi-panel-row--selected" : ""}`}
              onMouseEnter={() => setHistorySelectedIndex(i)}
            >
              <button
                type="button"
                onClick={() => handleSessionClick(s.id)}
                title={formatUserMessagePreview(s.title)}
                className="pi-hist-row-main"
              >
                <span className="pi-hist-idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="pi-hist-label">{formatUserMessagePreview(s.title)}</span>
              </button>
            </div>
          );
        })
      )}
    </>
  );

  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  const elevatedPanel = isElevatedPanel(panel, isMobileLayout);
  const toolbarActive = panel !== null && !elevatedPanel && !(previewOpen && panel === "files" && !isMobileLayout);
  const filesOverlay = !isMobileLayout && previewOpen && panel === "files";
  const showInlinePanel = panel !== null && !elevatedPanel;
  const hasDraft = text.trim().length > 0 || pendingAttachments.length > 0;

  function renderPanelBody(): ReactNode {
    if (!panel) return null;
    switch (panel) {
      case "commands":
        return showCommandList ? (
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="flex flex-1 min-h-0 overflow-auto pi-scrollbar pi-composer-panel-body">{commandListContent}</div>
          </div>
        ) : (
          commandsContent
        );
      case "model":
        return modelContent;
      case "history":
        return (
          <div className="pi-composer-panel-stack py-0.5">
            <PanelFilterBar value={historyQuery} onChange={setHistoryQuery} />
            <div className="pi-composer-panel-scroll pi-scrollbar pb-1">{historyContent}</div>
          </div>
        );
      case "files":
        if (!isMobileLayout && previewOpen) return null;
        return (
          <div className="flex flex-1 min-h-0 flex-col px-1 py-0.5">
            <FileTree onFileClick={onFileClick} />
          </div>
        );
      case "account":
        return <AccountPanel />;
      default:
        return null;
    }
  }

  // One slot per queued message (steering first, then follow-up) — each
  // stays a separate numbered cell rather than collapsing into a single
  // count, so "queue grows by one" is visible one slot at a time.
  const queuedItems: { key: string; source: "steering" | "followUp"; index: number; text: string }[] = [
    ...queuedSteering.map((text, index) => ({ key: `steering-${index}`, source: "steering" as const, index, text })),
    ...queuedFollowUp.map((text, index) => ({ key: `followUp-${index}`, source: "followUp" as const, index, text })),
  ];

  const badgeRow =
    queuedItems.length > 0 ? (
      <div className="pi-composer-badges" onClick={(e) => e.stopPropagation()}>
        <div className="pi-composer-queue-cell-wrap">
          <button
            type="button"
            className="pi-composer-queue-cell"
            onClick={(e) => { e.stopPropagation(); onEditQueued?.(queuedItems[0].source, queuedItems[0].index); }}
            aria-label={`${queuedItems.length} queued message${queuedItems.length > 1 ? "s" : ""} — not seen by the model yet, click to edit`}
          >
            {queuedItems.length}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div
      className="pi-composer-shell relative"
      ref={shellRef}
      onClick={focusInput}
    >
      {isStreaming && !isConnecting && (
        <button
          type="button"
          className="pi-composer-working pi-composer-working--shell"
          onClick={(e) => { e.stopPropagation(); onAbort?.(); }}
          title="Stop"
          aria-label="Stop — click to interrupt"
        >
          <span className="pi-composer-working-bars" aria-hidden="true">
            <span /><span /><span /><span />
          </span>
        </button>
      )}
      {isConnecting && (
        <div
          className="pi-composer-working pi-composer-working--shell pi-composer-connecting"
          aria-label="连接中…"
        >
          <span className="pi-composer-connecting-block" />
        </div>
      )}
      {badgeRow}
      <div
        className="pi-composer-toolbar"
        data-open={toolbarActive ? "true" : "false"}
        data-panel={toolbarActive && panel ? panel : undefined}
        data-files-overlay={filesOverlay ? "true" : "false"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pi-composer-panel">
          {showInlinePanel && renderPanelBody()}
        </div>

        <div className="pi-composer-toolbar-bar">
          {isMobileLayout && <div className="pi-composer-toolbar-bar-fill" aria-hidden="true" />}
          <div className="pi-composer-toolbar-bar-tail">
            {toolbarItems.map((item, index) => (
            <button
              style={{ width: `${btnWidthPx}px`, flex: `0 0 ${btnWidthPx}px` }}
              key={item.id}
              type="button"
              className={`pi-composer-toolbar-btn${item.id === "new-chat" && !hasDraft ? " pi-composer-toolbar-btn--accent" : ""}`}
              data-active={item.panel ? panel === item.panel : false}
              data-keyboard-focus={toolbarKeyboardFocus && toolbarIndex === index}
              onPointerDown={item.id === "new-chat" ? undefined : handleToolbarPointerDown}
              onClick={() => handleToolbarItemClick(item)}
              title={toolbarTitle(item)}
              aria-label={toolbarAriaLabel(item)}
            >
              {toolbarIcon(item)}
            </button>
          ))}
          </div>
        </div>
      </div>

      {filesOverlay && (
        <div className="pi-composer-files-overlay" onClick={(e) => e.stopPropagation()}>
          <FileTree onFileClick={onFileClick} />
        </div>
      )}

      <div className="pi-composer-body">
        {pendingAttachments.length > 0 && (
          <div className="pi-composer-attachments" onClick={(e) => e.stopPropagation()}>
            {pendingAttachments.map((item) => (
              <div
                key={item.id}
                className="pi-composer-attachment"
                data-status={item.status}
                title={item.status === "error" ? item.error : item.file.name}
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="pi-composer-attachment-thumb" />
                ) : (
                  <span className="pi-composer-attachment-file">
                    {item.file.name}
                  </span>
                )}
                {item.status === "processing" && (
                  <div className="pi-composer-attachment-overlay" aria-hidden="true">
                    <span className="pi-composer-attachment-spinner" />
                  </div>
                )}
                <button
                  type="button"
                  className="pi-composer-attachment-remove"
                  onClick={() => removePendingAttachment(item.id)}
                  aria-label={`Remove ${item.file.name}`}
                >
                  <X size={10} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="pi-composer-input-row">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          tabIndex={-1}
          accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.toml,.ini,.sh,.py,.rs,.go,.java,.c,.cpp,.h,.sql"
          className="sr-only"
          onChange={handleAttachmentInputChange}
        />
        <button
          type="button"
          className="pi-composer-attach-btn"
          onPointerDown={handleToolbarPointerDown}
          onClick={handleAttachClick}
          disabled={disabled || isStreaming || isConnecting || attachmentsProcessing()}
          title="Upload image or file"
          aria-label="Upload image or file"
        >
          <Plus strokeWidth={2} aria-hidden="true" />
        </button>
        <textarea
          ref={taRef}
          rows={MIN_ROWS}
          disabled={disabled || isConnecting}
          placeholder={
            isConnecting
              ? "连接中…"
              : attachmentsProcessing()
                ? "Preparing attachments..."
                : isStreaming
                  ? "Type — queued until the model is ready to see it..."
                  : "Type / for commands..."
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onInput={() => {
            /* Defer resize so iOS Safari can finish pointer/caret tracking before we
               mutate the textarea geometry. Synchronous style mutation during an input
               event is a known cause of cursor-order bugs with dictation / IME. */
            requestAnimationFrame(resizeComposerInput);
          }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          enterKeyHint="send"
          spellCheck={false}
          {...imeProps}
          className="pi-composer-input min-w-0 flex-1 resize-none border-none bg-transparent px-1.5 py-1.5 text-[var(--pi-text)] outline-none placeholder:text-[#a8b0bc] disabled:cursor-not-allowed"
        />
        <button
          type="button"
          className={`pi-composer-send-btn${hasDraft ? " pi-composer-send-btn--accent" : ""}`}
          onPointerDown={handleToolbarPointerDown}
          onClick={handleSend}
          disabled={!canSendNow(text)}
          title="Send message"
          aria-label="Send message"
        >
          <Send strokeWidth={2} aria-hidden="true" />
        </button>
        </div>
      </div>
    </div>
  );
}
