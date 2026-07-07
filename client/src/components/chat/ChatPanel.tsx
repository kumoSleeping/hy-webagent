import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAuthStore } from "../../stores/authStore";
import { useSlashStore, type SlashCommand } from "../../stores/slashStore";
import type { ChatWebSocketApi } from "../../hooks/useChatWebSocket";
import { useComposerFocusStore } from "../../stores/composerFocusStore";
import { useMobileLayout } from "../../hooks/useMobileLayout";
import { isElevatedPanel } from "../../lib/composerLayout";
import { apiGet } from "../../lib/api";
import { PlatformSignature } from "../common/PlatformSignature";
import { MessageFeed } from "./MessageFeed";
import { ComposerBar } from "./ComposerBar";
import { StatusBar } from "./StatusBar";
import { CenterStage, useCenterStageOpen } from "./CenterStage";
import { useStatusBarSync } from "../../hooks/useStatusBarSync";
import { SlashModelSelector } from "../slash/SlashModelSelector";
import { SlashSettingsPanel } from "../slash/SlashSettingsPanel";
import { SlashSessionTree } from "../slash/SlashSessionTree";
import { SlashExportDialog } from "../slash/SlashExportDialog";
import { SlashToast } from "../slash/SlashToast";
import { isSilentCommand } from "../../lib/silentCommands";
import { openToolbarSlashPanel, resolveToolbarSlash } from "../../lib/toolbarSlashCommands";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useStartupPreferencesStore } from "../../stores/startupPreferencesStore";
import { resolveCenteredStartup } from "../../lib/startupPreferences";
import type { FileEntry, EditorTab, EditorViewMode } from "../../types";

interface ModelInfo {
  provider: string;
  id: string;
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
  currentModel?: string;
  availableThinkingLevels?: string[];
  currentThinkingLevel?: string;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
}

interface ChatPanelProps {
  chat: ChatWebSocketApi;
  onNewChat: () => void;
  onFileClick: (entry: FileEntry) => void;
  editorTabs: EditorTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onViewModeChange: (tabId: string, viewMode: EditorViewMode) => void;
  onEditorFocus?: () => void;
}

export function ChatPanel({
  chat,
  onNewChat, onFileClick, editorTabs, activeTabId, onTabClick, onTabClose, onContentChange, onViewModeChange,
  onEditorFocus,
}: ChatPanelProps) {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);
  const hydratedPiSessionId = useChatStore((s) => s.hydratedPiSessionId);
  const queuedSteering = useChatStore((s) => s.queuedSteering);
  const queuedFollowUp = useChatStore((s) => s.queuedFollowUp);
  const composerPanel = useComposerPanelStore((s) => s.panel);
  const treeMode = useComposerPanelStore((s) => s.treeMode);
  const isMobileLayout = useMobileLayout();
  const welcomeEnabled = useStartupPreferencesStore((s) => s.welcomeEnabled);
  const composerPosition = useStartupPreferencesStore((s) => s.composerPosition);
  const centerStageOpen = useCenterStageOpen(isMobileLayout);
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  /** File preview uses the stack above composer. */
  const elevatedOpen = previewOpen || isElevatedPanel(composerPanel, isMobileLayout);
  const dockCardOpen = centerStageOpen && !elevatedOpen;
  const closeAll = useComposerPanelStore((s) => s.closeAll);
  const closeComposerPanel = useComposerPanelStore((s) => s.closePanel);
  const closePreview = useComposerPanelStore((s) => s.closePreview);
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  // Only pick welcome vs conversation layout once the session is hydrated —
  // avoids the composer jumping from center to bottom while history loads.
  const isHydrating = Boolean(activePiSessionId && hydratedPiSessionId !== activePiSessionId);
  const isGuestView = useAuthStore((s) => s.userId) === "__guest__";
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  useEffect(() => {
    setWelcomeDismissed(false);
  }, [activePiSessionId]);
  const isEmptySession =
    hydratedPiSessionId === activePiSessionId &&
    messages.length === 0;
  const isStartupLayout =
    !welcomeDismissed &&
    isEmptySession;
  const useCenteredStartup =
    isStartupLayout &&
    resolveCenteredStartup(composerPosition, isMobileLayout);
  const showWelcomeSignature = isStartupLayout && welcomeEnabled && !useCenteredStartup;
  const notify = useNotificationStore((s) => s.notify);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const activePanel = useSlashStore((s) => s.activePanel);
  const setActivePanel = useSlashStore((s) => s.setActivePanel);
  const setCommands = useSlashStore((s) => s.setCommands);
  const toast = useSlashStore((s) => s.toast);
  const clearToast = useSlashStore((s) => s.clearToast);
  const lastResult = useSlashStore((s) => s.lastResult);
  const {
    sendPrompt,
    sendSteer,
    sendFollowUp,
    sendAbort,
    sendDequeue,
    sendSlash,
    sendExtensionUiResponse,
  } = chat;

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [availableLevels, setAvailableLevels] = useState<string[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>("medium");
  const [steeringMode, setSteeringMode] = useState<"all" | "one-at-a-time">("all");
  const [followUpMode, setFollowUpMode] = useState<"all" | "one-at-a-time">("all");
  const [scopedIds, setScopedIds] = useState<string[]>([]);
  const setDynamicCommands = useSlashStore((s) => s.setDynamicCommands);

  useStatusBarSync();

  useEffect(() => {
    if (!activePiSessionId) return;
    apiGet<ModelsResponse>("/api/models")
      .then((data) => {
        setModels(data.models || []);
        setCurrentModel(data.currentModel || "");
        setAvailableLevels(data.availableThinkingLevels || []);
        setCurrentLevel(data.currentThinkingLevel || "medium");
        setSteeringMode(data.steeringMode || "all");
        setFollowUpMode(data.followUpMode || "all");
      })
      .catch(console.error);

    apiGet<{ system: SlashCommand[]; dynamic: SlashCommand[] }>("/api/slash/commands")
      .then((data) => {
        if (data.system?.length) setCommands(data.system);
        setDynamicCommands(data.dynamic || []);
      })
      .catch(console.error);
  }, [activePiSessionId, setCommands, setDynamicCommands]);

  function refreshModels() {
    if (!activePiSessionId) return;
    apiGet<ModelsResponse>("/api/models")
      .then((data) => {
        setModels(data.models || []);
        setCurrentModel(data.currentModel || "");
        setAvailableLevels(data.availableThinkingLevels || []);
        setCurrentLevel(data.currentThinkingLevel || "medium");
        setSteeringMode(data.steeringMode || "all");
        setFollowUpMode(data.followUpMode || "all");
      })
      .catch(console.error);
  }

  useEffect(() => {
    if (composerPanel !== "model" || !activePiSessionId) return;
    refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerPanel, activePiSessionId]);

  useEffect(() => {
    if (activePanel === "session" && activePiSessionId) {
      sendSlash("session.stats", {});
    }
  }, [activePanel, activePiSessionId, sendSlash]);

  useEffect(() => {
    if (activePanel === "scoped-models") {
      setScopedIds([]);
    }
  }, [activePanel]);

  function notifySendFailure() {
    notify("连接未就绪，消息未发送。请稍候再试。", "info");
  }

  function handleSend(text: string, images?: { mediaType: string; data: string }[], displayText?: string) {
    const trimmed = displayText ?? text.trim();
    const promptText = text.trim();
    if (!promptText && !images?.length) return;

    // Slash / extension commands — trigger only, never show in main chat.
    if (isSilentCommand(trimmed)) {
      const toolbarSlash = resolveToolbarSlash(trimmed);
      if (toolbarSlash) {
        openToolbarSlashPanel(toolbarSlash);
        if (toolbarSlash.fetchSessions) void fetchSessions();
        return;
      }
      const panelId = resolvePanelSlash(trimmed);
      if (panelId) {
        if (panelId === "model") {
          useComposerPanelStore.getState().openModelPanel();
          return;
        }
        setActivePanel(panelId);
        useComposerPanelStore.getState().setPanel("commands");
        return;
      }
      const slash = parseSlashCommand(trimmed);
      if (slash) {
        handleExecute(slash.command, slash.args);
      } else if (!sendPrompt(promptText, images)) {
        notifySendFailure();
      }
      setTimeout(() => fetchSessions(), 800);
      return;
    }

    if (!sendPrompt(promptText, images)) {
      notifySendFailure();
      return;
    }
    setWelcomeDismissed(true);
    setTimeout(() => fetchSessions(), 800);
  }

  // Inserting a message while the agent is already running is queued as a
  // steering message and delivered once the current turn's tool calls
  // finish, before the next model call — the model hasn't actually seen it
  // yet at send time, so it stays out of the transcript (shown only as a
  // pending badge on the composer) until the SDK persists it via message_end.
  function handleSteer(text: string) {
    if (!sendSteer(text)) notifySendFailure();
  }

  // The SDK can only pull the *entire* steering/follow-up queue back out at
  // once (no per-message edit API) — so "editing one queued message" is
  // emulated by dequeuing everything, immediately re-queuing every other
  // message in its original order, and handing just the target message's
  // text back to the composer. Once the user resends it, it lands at the
  // back of the (already-repopulated) queue — the "newest" slot, matching
  // how a freshly typed steering message would land.
  function handleEditQueued(source: "steering" | "followUp", index: number) {
    const state = useChatStore.getState();
    const text = (source === "steering" ? state.queuedSteering : state.queuedFollowUp)[index];
    if (text == null) return;
    const remainingSteering = source === "steering"
      ? state.queuedSteering.filter((_, i) => i !== index)
      : state.queuedSteering;
    const remainingFollowUp = source === "followUp"
      ? state.queuedFollowUp.filter((_, i) => i !== index)
      : state.queuedFollowUp;

    useChatStore.getState().clearQueuedMessagesLocally();
    sendDequeue();
    for (const t of remainingSteering) sendSteer(t);
    for (const t of remainingFollowUp) sendFollowUp(t);
    useComposerFocusStore.getState().requestFocus(text);
  }

  function handleExecute(command: string, args: Record<string, unknown> = {}) {
    sendSlash(command, args);
    if (command === "model.set") {
      setTimeout(refreshModels, 300);
    }
    // A summarized tree navigation kicks off an LLM call — SlashSessionTree
    // shows its own loading/cancel state and closes the panel itself once
    // the result comes back, instead of the panel vanishing immediately.
    if (command === "session.navigateTree" && args.summarize) return;
    setActivePanel(null);
    closeComposerPanel();
  }

  function resolvePanelSlash(text: string): string | null {
    if (!text.startsWith("/")) return null;
    const trimmed = text.slice(1).trim();
    const [id, ...rest] = trimmed.split(/\s+/);
    if (!id || rest.some((part) => part.length > 0)) return null;
    const lower = id.toLowerCase();
    const all = [...useSlashStore.getState().commands, ...useSlashStore.getState().dynamicCommands];
    const cmd = all.find((c) => c.id.toLowerCase() === lower || c.label.toLowerCase() === lower);
    return cmd?.kind === "panel" ? cmd.id : null;
  }

  function parseSlashCommand(text: string): { command: string; args: Record<string, unknown> } | null {
    if (!text.startsWith("/")) return null;
    const trimmed = text.slice(1).trim();
    const [id, ...rest] = trimmed.split(/\s+/);
    const argText = rest.join(" ").trim();

    switch (id) {
      case "new":
        return { command: "session.new", args: {} };
      case "compact":
        return { command: "session.compact", args: {} };
      case "name":
        if (!argText) return null;
        return { command: "session.name", args: { name: argText } };
      case "copy":
        return { command: "session.copy", args: {} };
      case "import":
        if (!argText) return null;
        return { command: "session.importJsonl", args: { sourcePath: argText } };
      case "reload":
        return { command: "session.reload", args: {} };
      default:
        return null;
    }
  }

  function closePanel() {
    setActivePanel(null);
    closeComposerPanel();
  }

  function dismissOverlays() {
    closeAll();
    useExtensionUiStore.getState().setExtensionPanelDismissed(true);
  }

  // ESC dismisses whatever popup/preview is open, from anywhere — not just
  // while the composer textarea has focus.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (composerPanel || centerStageOpen) {
        const dialog = useExtensionUiStore.getState().activeDialog;
        if (dialog) {
          sendExtensionUiResponse({ id: dialog.id, cancelled: true });
          useExtensionUiStore.getState().setDialog(null);
        } else {
          dismissOverlays();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [composerPanel, centerStageOpen, closeAll, sendExtensionUiResponse]);

  function toggleScoped(id: string) {
    setScopedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function saveScoped() {
    const modelArgs = scopedIds.map((combined) => {
      const idx = combined.indexOf("/");
      const provider = idx > 0 ? combined.slice(0, idx) : "default";
      const modelId = idx > 0 ? combined.slice(idx + 1) : combined;
      return { provider, modelId };
    });
    sendSlash("model.setScoped", { models: modelArgs });
    closePanel();
  }

  function renderStats(data: unknown) {
    if (!data || typeof data !== "object") {
      return <p className="px-2 py-3 text-xs text-[var(--pi-muted)] font-mono">No stats available</p>;
    }
    return Object.entries(data).map(([key, value]) => (
      <div key={key} className="flex items-center justify-between gap-2 border-b border-[var(--pi-line)] py-1.5">
        <span className="text-[0.66rem] uppercase tracking-wider text-[var(--pi-muted)]">{key}</span>
        <span className="text-[0.84rem] font-mono text-[var(--pi-text)] truncate">
          {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    ));
  }

  // All slash-command UIs render in the same right-aligned popup that the
  // commands/history/files toolbar buttons share — never their own
  // full-width floating panel — so the experience stays one consistent
  // attached block no matter which command is active.
  let commandsContent: ReactNode = null;
  if (activePanel === "settings") {
    commandsContent = (
      <SlashSettingsPanel
        availableLevels={availableLevels}
        thinkingLevel={currentLevel}
        steeringMode={steeringMode}
        followUpMode={followUpMode}
        onExecute={handleExecute}
        onClose={closePanel}
        onModelRefresh={() => {
          if (!activePiSessionId) return;
          apiGet<ModelsResponse>("/api/models")
            .then((data) => {
              setAvailableLevels(data.availableThinkingLevels || []);
              setCurrentLevel(data.currentThinkingLevel || "medium");
              setSteeringMode(data.steeringMode || "all");
              setFollowUpMode(data.followUpMode || "all");
            })
            .catch(console.error);
        }}
      />
    );
  } else if (activePanel === "session") {
    commandsContent = (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-auto pi-scrollbar p-2.5">
          {lastResult && (lastResult as any).data ? renderStats((lastResult as any).data) : null}
        </div>
      </div>
    );
  } else if (activePanel === "scoped-models") {
    commandsContent = (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-auto pi-scrollbar p-1.5 space-y-1">
          {models.map((model) => {
            const id = `${model.provider}/${model.id}`;
            const checked = scopedIds.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleScoped(id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left border transition-colors cursor-pointer outline-none ${
                  checked
                    ? "border-[var(--pi-theme)] bg-[var(--pi-accent-soft)]"
                    : "border-transparent bg-[var(--pi-panel-subtle)] hover:border-[var(--pi-line)]"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center border border-[var(--pi-line)] bg-white text-[var(--pi-text)]">
                  {checked && <Check size={12} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="pi-composer-panel-item-name truncate">{model.name ?? model.id}</div>
                  <div className="text-sm uppercase tracking-wider text-[var(--pi-muted)] font-mono">
                    {model.provider}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="shrink-0 flex items-center justify-end p-2.5 gap-1.5">
            <button
              type="button"
              onClick={closePanel}
              className="flex h-9 items-center px-3 text-sm uppercase tracking-wider text-[var(--pi-muted)] border border-[var(--pi-line)] bg-white hover:border-[var(--pi-theme)] hover:text-[var(--pi-theme)] cursor-pointer outline-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveScoped}
              className="flex h-9 items-center gap-1.5 bg-[var(--pi-text)] px-3 text-sm uppercase tracking-wider text-white transition-all hover:bg-[#1c1c1e] cursor-pointer outline-none"
            >
              <Check size={14} />
              Save
            </button>
        </div>
      </div>
    );
  } else if (activePanel === "export") {
    commandsContent = <SlashExportDialog onExecute={handleExecute} onClose={closePanel} />;
  }

  // Conversation tree — Pi's signature feature — gets its own direct
  // toolbar toggle rather than living only inside the commands list.
  const treeContent: ReactNode = activePiSessionId ? (
    <SlashSessionTree sessionId={activePiSessionId} mode={treeMode} onExecute={handleExecute} />
  ) : null;

  const modelContent: ReactNode = (
    <SlashModelSelector models={models} currentModel={currentModel} onExecute={handleExecute} onClose={closePanel} />
  );

  return (
    <div
      className={`pi-app-shell pi-app-shell--revealed${useCenteredStartup && !isHydrating ? " pi-app-shell--welcome" : ""}${isHydrating ? " pi-app-shell--hydrating" : ""}${isMobileLayout ? " pi-app-shell--mobile" : ""}`}
    >
      {!useCenteredStartup && !isHydrating && <MessageFeed />}
      {showWelcomeSignature && !isHydrating && <PlatformSignature />}
      {(composerPanel || centerStageOpen) && (
        <div
          className="pi-click-backdrop"
          onClick={dismissOverlays}
          aria-hidden="true"
        />
      )}
      <div className="pi-interactive-shell">
        <div
          className={`pi-composer-dock${dockCardOpen ? " pi-composer-dock--open" : ""}${elevatedOpen ? " pi-composer-dock--preview" : ""}`}
        >
          <div className="pi-preview-stack">
            <CenterStage
              onRespondExtensionUi={sendExtensionUiResponse}
              editorTabs={editorTabs}
              activeTabId={activeTabId}
              onTabClick={onTabClick}
              onTabClose={onTabClose}
              onContentChange={onContentChange}
              onViewModeChange={onViewModeChange}
              onEditorFocus={onEditorFocus}
              treeContent={treeContent}
              treeMode={treeMode}
              onClose={() => {
                closePreview();
                useExtensionUiStore.getState().setExtensionPanelDismissed(true);
              }}
            />
          </div>
          <ComposerBar
            disabled={isHydrating || isGuestView}
            isStreaming={isStreaming}
            isMobileLayout={isMobileLayout}
            onSend={handleSend}
            onSteer={handleSteer}
            onAbort={sendAbort}
            queuedSteering={queuedSteering}
            queuedFollowUp={queuedFollowUp}
            onEditQueued={handleEditQueued}
            onSlash={(cmd) => {
              if (cmd === "model") {
                useComposerPanelStore.getState().openModelPanel();
                return;
              }
              setActivePanel(cmd);
            }}
            onNewChat={onNewChat}
            onFileClick={onFileClick}
            commandsContent={commandsContent}
            modelContent={modelContent}
          />
        </div>
        <StatusBar />

        {toast && (
          <div className="absolute left-0 right-0 bottom-full mb-2 z-50">
            <SlashToast message={toast.message} type={toast.type} onClose={clearToast} />
          </div>
        )}
      </div>
    </div>
  );
}
