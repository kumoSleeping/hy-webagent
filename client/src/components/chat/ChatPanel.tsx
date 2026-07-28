import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Cpu } from "lucide-react";
import { PanelActions, PanelBody, PanelButton, PanelListRow } from "../common/panel";
import { useChatStore } from "../../stores/chatStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAuthStore } from "../../stores/authStore";
import { useSlashStore, type SlashCommand } from "../../stores/slashStore";
import type { ChatWebSocketApi } from "../../hooks/useChatWebSocket";
import { useComposerFocusStore } from "../../stores/composerFocusStore";
import { useMobileLayout } from "../../hooks/useMobileLayout";
import { apiGet } from "../../lib/api";
import { ComposerBar } from "./ComposerBar";
import { CenterStage, useCenterStageOpen } from "./CenterStage";
import { useStatusBarSync } from "../../hooks/useStatusBarSync";
import { SlashModelSelector } from "../slash/SlashModelSelector";
import { SlashSettingsPanel } from "../slash/SlashSettingsPanel";
import { SlashSessionTree } from "../slash/SlashSessionTree";
import { SlashExportDialog } from "../slash/SlashExportDialog";
import { isSilentCommand } from "../../lib/silentCommands";
import { openToolbarSlashPanel, resolveToolbarSlash } from "../../lib/toolbarSlashCommands";
import { stripFileAttachmentTags } from "../../lib/prepareAttachments";
import { formatSessionStats } from "../../lib/sessionStatsFormat";
import { useComposerPanelStore } from "../../stores/composerPanelStore";
import {
  setSessionWindowsPersistScope,
  useSessionWindowsStore,
} from "../../stores/sessionWindowsStore";
import { SessionWindowsHost } from "./SessionWindow";
import { clearKeepAlive } from "../../stores/sessionKeepAliveStore";
import { useExtensionUiStore } from "../../stores/extensionUiStore";
import { flashStatus } from "../../stores/statusBarStore";
import type { FileEntry, EditorTab, EditorViewMode } from "../../types";
import { useGroupPreview } from "../bot/GroupPreviewContext";

const MessageFeed = lazy(() =>
  import("./MessageFeed").then((module) => ({ default: module.MessageFeed }))
);

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
  onFileClick: (entry: FileEntry) => void | Promise<void>;
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
  const hydratedPiSessionId = useChatStore((s) => s.hydratedPiSessionId);
  const queuedSteering = useChatStore((s) => s.queuedSteering);
  const queuedFollowUp = useChatStore((s) => s.queuedFollowUp);
  const composerPanel = useComposerPanelStore((s) => s.panel);
  const treeMode = useComposerPanelStore((s) => s.treeMode);
  const isMobileLayout = useMobileLayout();
  const centerStageOpen = useCenterStageOpen(isMobileLayout);
  const closeAll = useComposerPanelStore((s) => s.closeAll);
  const closeComposerPanel = useComposerPanelStore((s) => s.closePanel);
  const closePreview = useComposerPanelStore((s) => s.closePreview);
  const previewOpen = useComposerPanelStore((s) => s.previewOpen);
  /** /api/models 按会话缓存(见下方 effect):键=piSessionId。 */
  const modelsCacheRef = useRef<Map<string, ModelsResponse>>(new Map());
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  // 设计稿 F:激活会话在小窗里直播时,背景主区让位。
  const activeSessionWindowed = useSessionWindowsStore((s) =>
    s.windows.some((w) => w.sessionId === activePiSessionId),
  );
  const hasSessionWindows = useSessionWindowsStore((s) => s.windows.length > 0);
  // Only pick welcome vs conversation layout once the session is hydrated —
  // avoids the composer jumping from center to bottom while history loads.
  const isHydrating = Boolean(activePiSessionId && hydratedPiSessionId !== activePiSessionId);

  const isGuestView = useAuthStore((s) => s.userId) === "__guest__";
  const isPreviewMode = useAuthStore((s) => s.isPreviewMode);
  const groupPreview = useGroupPreview();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const activePanel = useSlashStore((s) => s.activePanel);
  const setActivePanel = useSlashStore((s) => s.setActivePanel);
  const setCommands = useSlashStore((s) => s.setCommands);
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

  // 会话小窗布局按用户持久化;进入工作区恢复上次开着的窗。
  const authUserId = useAuthStore((s) => s.userId);
  useEffect(() => {
    if (!authUserId || groupPreview) return;
    clearKeepAlive();
    const windowsStore = useSessionWindowsStore.getState();
    windowsStore.closeAll();
    const persisted = setSessionWindowsPersistScope(authUserId);
    for (const entry of persisted.open) {
      windowsStore.open(entry.sessionId);
    }
    // 上次是长按退出的:窗集合在暂存里,再长按原样弹回。
    windowsStore.seedStash(persisted.stash.map((e) => e.sessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId]);

  useEffect(() => {
    if (!activePiSessionId || groupPreview) return;
    // /api/models 每个会话只网络请求一次:服务端会顺带探 provider 端点
    // (jina 等),来回切会话每次重拉 = 肉眼可见的慢半拍。切回时重放
    // 该会话的缓存(currentModel 等是会话级状态,不能纯跳过);
    // 主动换模型走 refreshModels() 会刷新缓存。
    const applyModels = (data: ModelsResponse) => {
      setModels(data.models || []);
      setCurrentModel(data.currentModel || "");
      setAvailableLevels(data.availableThinkingLevels || []);
      setCurrentLevel(data.currentThinkingLevel || "medium");
      setSteeringMode(data.steeringMode || "all");
      setFollowUpMode(data.followUpMode || "all");
    };
    const cached = modelsCacheRef.current.get(activePiSessionId);
    if (cached) {
      applyModels(cached);
    } else {
      apiGet<ModelsResponse>("/api/models")
        .then((data) => {
          modelsCacheRef.current.set(activePiSessionId, data);
          applyModels(data);
        })
        .catch(console.error);
    }

    apiGet<{ system: SlashCommand[]; dynamic: SlashCommand[] }>("/api/slash/commands")
      .then((data) => {
        if (data.system?.length) setCommands(data.system);
        setDynamicCommands(data.dynamic || []);
      })
      .catch(console.error);
  }, [activePiSessionId, groupPreview, setCommands, setDynamicCommands]);

  function refreshModels() {
    if (!activePiSessionId) return;
    apiGet<ModelsResponse>("/api/models")
      .then((data) => {
        modelsCacheRef.current.set(activePiSessionId, data);
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
    if (groupPreview || composerPanel !== "model" || !activePiSessionId) return;
    refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerPanel, activePiSessionId, groupPreview]);

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
    flashStatus("连接未就绪，消息未发送。请稍候再试。", "error");
  }

  function handleSend(text: string, images?: { mediaType: string; data: string }[], displayText?: string) {
    const trimmed = displayText ?? text.trim();
    const promptText = text.trim();
    if (!promptText && !images?.length) return false;

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
          return true;
        }
        setActivePanel(panelId);
        useComposerPanelStore.getState().setPanel("commands");
        return true;
      }
      const slash = parseSlashCommand(trimmed);
      if (slash) {
        handleExecute(slash.command, slash.args);
      } else if (!sendPrompt(promptText, images)) {
        notifySendFailure();
        return false;
      }
      setTimeout(() => fetchSessions(), 800);
      return true;
    }

    if (!sendPrompt(promptText, images)) {
      notifySendFailure();
      return false;
    }
    useChatStore.getState().appendOptimisticUserMessage(
      stripFileAttachmentTags(trimmed),
      images?.map((img) => ({ mediaType: img.mediaType, data: img.data }))
    );
    setTimeout(() => fetchSessions(), 800);
    return true;
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
      if (composerPanel || previewOpen || centerStageOpen) {
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
  }, [composerPanel, previewOpen, centerStageOpen, closeAll, sendExtensionUiResponse]);

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
    const rows = formatSessionStats(data);
    if (!rows) return undefined;
    return rows.map((row, index) => (
      <PanelListRow
        key={row.key}
        leading={String(index + 1).padStart(2, "0")}
        leadingKind="index"
        title={row.label}
        detail={row.detail}
        titleAttr={row.titleAttr}
      />
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
    const stats = lastResult && (lastResult as any).data
      ? renderStats((lastResult as any).data)
      : undefined;
    commandsContent = (
      <PanelBody
        variant="list"
        loading={!lastResult}
        empty={!stats ? "No stats available" : undefined}
      >
        {stats}
      </PanelBody>
    );
  } else if (activePanel === "scoped-models") {
    commandsContent = (
      <PanelBody
        variant="list"
        empty={models.length === 0 ? "No models available" : undefined}
        footer={
          <PanelActions>
            <PanelButton variant="ghost" onClick={closePanel}>Cancel</PanelButton>
            <PanelButton variant="primary" onClick={saveScoped}>
              <Check size={12} aria-hidden="true" />
              Save
            </PanelButton>
          </PanelActions>
        }
      >
        {models.map((model) => {
          const id = `${model.provider}/${model.id}`;
          const checked = scopedIds.includes(id);
          return (
            <PanelListRow
              key={id}
              leading={checked ? <Check size={14} strokeWidth={2.5} /> : <Cpu size={14} strokeWidth={2} />}
              leadingKind="icon"
              title={model.name ?? model.id}
              detail={model.provider}
              selected={checked}
              onClick={() => toggleScoped(id)}
            />
          );
        })}
      </PanelBody>
    );
  } else if (activePanel === "export") {
    commandsContent = <SlashExportDialog onExecute={handleExecute} onClose={closePanel} />;
  }

  // Conversation tree — Pi's signature feature — gets its own direct
  // toolbar toggle rather than living only inside the commands list.
  const treeContent: ReactNode = activePiSessionId ? (
    <SlashSessionTree sessionId={activePiSessionId} mode={treeMode} onExecute={handleExecute} />
  ) : null;

  const modelContent: ReactNode = groupPreview ? (
    <div className="pi-group-preview-restricted">
      <strong>模型由群聊机器人管理</strong>
      <span>此处保留模型信息入口，但群组预览中不能切换模型。</span>
    </div>
  ) : (
    <SlashModelSelector models={models} currentModel={currentModel} onExecute={handleExecute} onClose={closePanel} />
  );

  const groupFilesContent: ReactNode = (
    <div className="pi-group-preview-restricted">
      <strong>文件功能仅供展示</strong>
      <span>请在正常聊天中登录后查看和操作工作区文件。</span>
    </div>
  );

  const groupAccountContent: ReactNode = groupPreview ? (
    <PanelBody
      variant="list"
      footer={
        <PanelActions>
          <PanelButton variant="primary" onClick={groupPreview.returnToChat}>
            返回正常聊天
          </PanelButton>
        </PanelActions>
      }
    >
      <PanelListRow leading="01" leadingKind="index" title={groupPreview.channelDisplayName} detail="Group" />
      <PanelListRow
        leading="02"
        leadingKind="index"
        title={`@${groupPreview.botSlug} · ${groupPreview.botDisplayName}`}
        detail="Bot"
      />
      <PanelListRow leading="03" leadingKind="index" title="只读群组预览" detail="Mode" />
    </PanelBody>
  ) : null;

  return (
    <div
      className={`pi-app-shell pi-app-shell--revealed${isHydrating ? " pi-app-shell--hydrating" : ""}${isMobileLayout ? " pi-app-shell--mobile" : ""}`}
    >
      {!isHydrating && !activeSessionWindowed && (
        <Suspense fallback={null}>
          <MessageFeed />
        </Suspense>
      )}
      {/* 小窗模式下面板/预览常驻(和会话窗一样只认红 ✕),点外不再关;
          backdrop 只在无窗时(或扩展 CenterStage 打开时)出场。 */}
      {(((composerPanel || previewOpen) && !hasSessionWindows) || centerStageOpen) && (
        <div
          className="pi-click-backdrop"
          onClick={dismissOverlays}
          aria-hidden="true"
        />
      )}
      <div className="pi-interactive-shell">
        <div
          className={`pi-composer-dock${centerStageOpen ? " pi-composer-dock--elevated" : ""}`}
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
          {(!isPreviewMode || groupPreview) && (
          <ComposerBar
            disabled={isGuestView || Boolean(groupPreview)}
            sendDisabled={isHydrating || !activePiSessionId}
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
            groupPreview={groupPreview ? {
              notice: "Group chat only...",
              onReturnToChat: groupPreview.returnToChat,
              onSelectSession: groupPreview.selectSession,
              filesContent: groupFilesContent,
              accountContent: groupAccountContent,
            } : undefined}
          />
          )}
        </div>
        <SessionWindowsHost
          disabled={isGuestView || Boolean(groupPreview)}
          onSend={(text) => handleSend(text)}
          onSteer={handleSteer}
          onAbort={sendAbort}
        />
        {/* 渐隐幕:会话窗拖进输入区时向下溶入背景(见 design.css)。 */}
        <div className="pi-float-fade" aria-hidden="true" />
      </div>
    </div>
  );
}
