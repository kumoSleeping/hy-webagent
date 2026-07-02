import {
  createAgentSession,
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
  CompactionResult,
  CreateAgentSessionRuntimeFactory,
  SessionStats,
} from "@earendil-works/pi-coding-agent";
import { config } from "../config.js";
import { existsSync } from "node:fs";
import { findSessionFilePath } from "./session-files.js";
import { computeFooterSnapshot, type FooterSnapshot } from "./footer-stats.js";
import { createWebExtensionUIContext, type StatusUpdatePayload } from "./web-ui-context.js";
import { ExtensionUIBridge } from "./extension-ui-bridge.js";
import type { ExtensionUIRequest, ExtensionUIResponse } from "./extension-ui-types.js";
import { WebWidgetHost, type WidgetSnapshot } from "./web-widget-host.js";
import { mapSessionTree, type ClientTreeNode } from "./session-tree.js";
import { agentCwdFromWorkspace, ensureUserAgentDir } from "./isolation.js";
import {
  assertPlatformRulesLoaded,
  ADMIN_SKILLS_DIR,
  createPlatformResourceLoader,
  getPlatformResourceLoaderOptions,
  loadPlatformSystemMd,
} from "./platform-system.js";
import { persistChatAttachments } from "./chat-attachments.js";
import {
  filterModels,
  isModelAllowed,
  modelPolicyError,
  type ResolvedModelPolicy,
} from "../model-policy.js";
import { injectRuntimeProviderKeys } from "../platform-credentials.js";

type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];
type SteeringMode = Parameters<AgentSession["setSteeringMode"]>[0];
type FollowUpMode = Parameters<AgentSession["setFollowUpMode"]>[0];

export type PiExtensionUiCallback = (userId: string, request: ExtensionUIRequest) => void;
export type PiStatusCallback = (userId: string, update: StatusUpdatePayload) => void;
export type PiWidgetCallback = (userId: string, snapshot: WidgetSnapshot) => void;
export type PiFooterCallback = (userId: string, snapshot: FooterSnapshot) => void;
export type PiStatusSnapshot = Record<string, string>;

interface ModelRef {
  provider: string;
  id: string;
  name: string;
}

interface ScopedModelRef {
  provider: string;
  id: string;
  thinkingLevel?: ThinkingLevel;
}

interface UserPISession {
  sessionId: string;
  userId: string;
  session: AgentSession;
  unsubscribe: () => void;
  runtime?: AgentSessionRuntime;
  workspacePath: string;
  /** Agent file-tool cwd — always `{workspacePath}/projects`, matching the Files panel. */
  agentCwd: string;
  sessionDir: string;
  agentDir: string;
  isStreaming: boolean;
  createdAt: number;
  lastActivity: number;
  onEvent: PiEventCallback;
  onStatus?: PiStatusCallback;
  onWidget?: PiWidgetCallback;
  onFooter?: PiFooterCallback;
  widgetHost: WebWidgetHost;
  extensionUiBridge: ExtensionUIBridge;
  extensionStatuses: Map<string, string>;
  onExtensionUiRequest?: PiExtensionUiCallback;
  /** True after admin-skills/ was extendResources'd onto this session's loader. */
  adminSkillsExtended?: boolean;
}

type PiEventCallback = (userId: string, event: AgentSessionEvent) => void;

export class PISessionManager {
  private sessions = new Map<string, UserPISession>();
  /** Coalesce concurrent activate/open for the same user + session id (HTTP activate vs WS rehydrate). */
  private activateInFlight = new Map<string, Promise<UserPISession>>();

  constructor(
    private includeAdminSkillsFor: (userId: string) => boolean = () => false,
    private resolvePolicyForUser: (userId: string) => ResolvedModelPolicy = () => ({
      templateId: null,
      unrestricted: true,
      allow: null,
      providers: null,
    })
  ) {}

  shouldIncludeAdminSkills(userId: string): boolean {
    return this.includeAdminSkillsFor(userId);
  }

  /**
   * After a user is promoted to admin, inject admin-skills/ into live agent sessions
   * and reload so the model immediately sees platform-ops and other admin skills.
   */
  async syncUserPrivileges(userId: string): Promise<number> {
    const includeAdmin = this.includeAdminSkillsFor(userId);
    let reloaded = 0;
    for (const ps of this.sessions.values()) {
      if (ps.userId !== userId) continue;
      if (includeAdmin && !ps.adminSkillsExtended) {
        ps.session.resourceLoader.extendResources({
          skillPaths: [
            {
              path: ADMIN_SKILLS_DIR,
              metadata: {
                source: "pi-web-platform-admin",
                scope: "user",
                origin: "top-level",
              },
            },
          ],
        });
        ps.adminSkillsExtended = true;
      }
      await ps.session.reload();
      reloaded += 1;
    }
    return reloaded;
  }

  /** Re-apply model template policy on live sessions after admin changes a user's template. */
  async syncUserModelPolicy(userId: string): Promise<number> {
    let updated = 0;
    for (const ps of this.sessions.values()) {
      if (ps.userId !== userId) continue;
      await this.applySessionModelPolicy(ps);
      updated += 1;
    }
    return updated;
  }

  private policyForSession(ps: UserPISession): ResolvedModelPolicy {
    return this.resolvePolicyForUser(ps.userId);
  }

  private async applySessionModelPolicy(ps: UserPISession): Promise<void> {
    const policy = this.policyForSession(ps);
    if (policy.unrestricted) return;

    injectRuntimeProviderKeys(ps.session.modelRegistry.authStorage, policy.providers);
    await this.ensureAllowedCurrentModel(ps, policy);
  }

  private async ensureAllowedCurrentModel(
    ps: UserPISession,
    policy: ResolvedModelPolicy
  ): Promise<void> {
    const current = ps.session.model;
    if (current && isModelAllowed(policy, current.provider, current.id)) return;

    const allowed = filterModels(
      policy,
      ps.session.modelRegistry.getAvailable().map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
      }))
    );
    const fallback = allowed[0];
    if (!fallback) {
      throw new Error(
        `No models available for template "${policy.templateId ?? "full"}". Check platform credentials.`
      );
    }
    const model = ps.session.modelRegistry.find(fallback.provider, fallback.id);
    if (!model) {
      throw new Error(`Model not found: ${fallback.provider}/${fallback.id}`);
    }
    await ps.session.setModel(model);
  }

  private applyExtensionStatus(ps: UserPISession, key: string, text: string | null) {
    if (text === null) ps.extensionStatuses.delete(key);
    else ps.extensionStatuses.set(key, text);
    ps.onStatus?.(ps.userId, { key, text });
    this.pushFooterSnapshot(ps);
  }

  private pushFooterSnapshot(ps: UserPISession) {
    ps.onFooter?.(ps.userId, this.getFooterSnapshot(ps.sessionId));
  }

  getFooterSnapshot(sessionId: string): FooterSnapshot {
    const ps = this.sessions.get(sessionId);
    if (!ps) {
      return { pwdLine: "", statsLeft: "", modelRight: "", extensionLine: null };
    }
    return computeFooterSnapshot(ps.session, Object.fromEntries(ps.extensionStatuses));
  }

  getWidgetSnapshot(sessionId: string): WidgetSnapshot {
    const ps = this.sessions.get(sessionId);
    if (!ps) return { aboveEditor: {}, belowEditor: {} };
    return ps.widgetHost.getSnapshot();
  }

  /** Steering/follow-up messages queued behind the current turn — the
   * model hasn't actually processed these yet (delivered after the current
   * tool calls finish, before the next LLM call), so the web client keeps
   * them out of the transcript until they're actually consumed. */
  getQueuedMessages(sessionId: string): { steering: string[]; followUp: string[] } {
    const ps = this.sessions.get(sessionId);
    if (!ps) return { steering: [], followUp: [] };
    return {
      steering: [...ps.session.getSteeringMessages()],
      followUp: [...ps.session.getFollowUpMessages()],
    };
  }

  /** Pulls every queued message back out (SDK only supports clearing the
   * whole queue at once, no per-message edit) so the client can drop them
   * back into the composer for editing. */
  clearQueue(sessionId: string): { steering: string[]; followUp: string[] } {
    const ps = this.sessions.get(sessionId);
    if (!ps) return { steering: [], followUp: [] };
    return ps.session.clearQueue();
  }

  getExtensionStatusSnapshot(sessionId: string): PiStatusSnapshot {
    const ps = this.sessions.get(sessionId);
    if (!ps) return {};
    return Object.fromEntries(ps.extensionStatuses);
  }

  setStatusListener(sessionId: string, listener: PiStatusCallback | undefined) {
    const ps = this.sessions.get(sessionId);
    if (ps) ps.onStatus = listener;
  }

  setWidgetListener(sessionId: string, listener: PiWidgetCallback | undefined) {
    const ps = this.sessions.get(sessionId);
    if (ps) ps.onWidget = listener;
  }

  setFooterListener(sessionId: string, listener: PiFooterCallback | undefined) {
    const ps = this.sessions.get(sessionId);
    if (ps) ps.onFooter = listener;
  }

  setExtensionUiListener(sessionId: string, listener: PiExtensionUiCallback | undefined) {
    const ps = this.sessions.get(sessionId);
    if (ps) ps.onExtensionUiRequest = listener;
  }

  handleExtensionUiResponse(sessionId: string, response: ExtensionUIResponse): boolean {
    const ps = this.sessions.get(sessionId);
    if (!ps) return false;
    return ps.extensionUiBridge.handleResponse(response);
  }

  setWidgetRenderWidth(sessionId: string, width: number) {
    const ps = this.sessions.get(sessionId);
    if (!ps) return;
    ps.widgetHost.setRenderWidth(width);
    ps.onWidget?.(ps.userId, ps.widgetHost.getSnapshot());
  }

  private async bindWebExtensions(ps: UserPISession) {
    const uiContext = createWebExtensionUIContext({
      bridge: ps.extensionUiBridge,
      widgetHost: ps.widgetHost,
      onStatus: (update) => this.applyExtensionStatus(ps, update.key, update.text),
    });

    await ps.session.bindExtensions({
      uiContext,
      mode: "rpc",
      commandContextActions: {
        waitForIdle: () => ps.session.agent.waitForIdle(),
        newSession: async (options) => {
          const runtime = await this.ensureRuntime(ps);
          const result = await runtime.newSession(options);
          return { cancelled: result.cancelled };
        },
        fork: async (entryId, options) => {
          const runtime = await this.ensureRuntime(ps);
          const result = await runtime.fork(entryId, options);
          return { cancelled: result.cancelled };
        },
        navigateTree: async (targetId, options) => {
          const result = await ps.session.navigateTree(targetId, options);
          return { cancelled: result.cancelled };
        },
        switchSession: async (sessionPath, options) => {
          const runtime = await this.ensureRuntime(ps);
          return runtime.switchSession(sessionPath, options);
        },
        reload: async () => {
          await ps.session.reload();
        },
      },
    });
  }

  async createSession(
    userId: string,
    workspacePath: string,
    onEvent: PiEventCallback,
    piSessionId?: string
  ): Promise<UserPISession> {
    if (piSessionId) {
      return this.activateSessionById(userId, workspacePath, piSessionId, onEvent);
    }

    const policy = this.resolvePolicyForUser(userId);
    const sessionDir = `${workspacePath}/.pi/sessions`;
    const agentDir = await ensureUserAgentDir(workspacePath, {
      seedAuthFromGlobal: policy.unrestricted,
    });

    const agentCwd = agentCwdFromWorkspace(workspacePath);
    const sessionManager = SessionManager.create(workspacePath, sessionDir);
    const resourceLoader = await createPlatformResourceLoader(agentCwd, agentDir, {
      includeAdminSkills: this.includeAdminSkillsFor(userId),
      workspacePath,
      enableSandbox: !this.includeAdminSkillsFor(userId),
    });
    const { session } = await createAgentSession({
      cwd: agentCwd,
      agentDir,
      sessionManager,
      resourceLoader,
    });
    assertPlatformRulesLoaded(session.systemPrompt);

    const userSession = await this.registerUserSession(
      userId,
      workspacePath,
      sessionDir,
      agentDir,
      session,
      onEvent
    );
    await this.applySessionModelPolicy(userSession);
    this.persistEmptySessionFile(userSession);
    return userSession;
  }

  /**
   * Open or switch to a Pi session by its header id — uses runtime.switchSession
   * when a session is already loaded (same as Pi CLI /resume), otherwise cold-opens
   * the jsonl file.
   */
  async activateSessionById(
    userId: string,
    workspacePath: string,
    targetSessionId: string,
    onEvent: PiEventCallback
  ): Promise<UserPISession> {
    const lockKey = `${userId}:${targetSessionId}`;
    const inFlight = this.activateInFlight.get(lockKey);
    if (inFlight) return inFlight;

    const promise = this.doActivateSessionById(userId, workspacePath, targetSessionId, onEvent);
    this.activateInFlight.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      if (this.activateInFlight.get(lockKey) === promise) {
        this.activateInFlight.delete(lockKey);
      }
    }
  }

  private async doActivateSessionById(
    userId: string,
    workspacePath: string,
    targetSessionId: string,
    onEvent: PiEventCallback
  ): Promise<UserPISession> {
    const policy = this.resolvePolicyForUser(userId);
    const sessionDir = `${workspacePath}/.pi/sessions`;
    const agentDir = await ensureUserAgentDir(workspacePath, {
      seedAuthFromGlobal: policy.unrestricted,
    });
    const sessionPath = await findSessionFilePath(sessionDir, targetSessionId);
    if (!sessionPath) {
      throw new Error(`Session not found: ${targetSessionId}`);
    }

    const inMemory = this.sessions.get(targetSessionId);
    if (inMemory && inMemory.userId === userId) {
      inMemory.lastActivity = Date.now();
      return inMemory;
    }

    const current = this.getSessionForUser(userId);
    if (current) {
      // switchSession rebinds and binds extensions — skip the ensureRuntime bind to avoid double init notify.
      const runtime = await this.ensureRuntime(current, { skipExtensionBind: true });
      const result = await runtime.switchSession(sessionPath, { cwdOverride: agentCwdFromWorkspace(workspacePath) });
      if (result.cancelled) {
        await this.bindWebExtensions(current);
        throw new Error("Session switch cancelled");
      }
      current.lastActivity = Date.now();
      return current;
    }

    const agentCwd = agentCwdFromWorkspace(workspacePath);
    const sessionManager = SessionManager.open(sessionPath, sessionDir, workspacePath);
    const resourceLoader = await createPlatformResourceLoader(agentCwd, agentDir, {
      includeAdminSkills: this.includeAdminSkillsFor(userId),
      workspacePath,
      enableSandbox: !this.includeAdminSkillsFor(userId),
    });
    const { session } = await createAgentSession({
      cwd: agentCwd,
      agentDir,
      sessionManager,
      resourceLoader,
    });
    assertPlatformRulesLoaded(session.systemPrompt);

    const userSession = await this.registerUserSession(
      userId,
      workspacePath,
      sessionDir,
      agentDir,
      session,
      onEvent
    );
    await this.applySessionModelPolicy(userSession);
    return userSession;
  }

  /** Pi defers writing the session file until the first assistant reply — flush the header early so refresh/activate can find it. */
  private persistEmptySessionFile(userSession: UserPISession): void {
    const sm = userSession.session.sessionManager as unknown as {
      getSessionFile: () => string | undefined;
      _rewriteFile?: () => void;
      flushed?: boolean;
    };
    const file = sm.getSessionFile();
    if (!file || existsSync(file)) return;
    sm._rewriteFile?.();
    sm.flushed = true;
  }

  private async registerUserSession(
    userId: string,
    workspacePath: string,
    sessionDir: string,
    agentDir: string,
    session: AgentSession,
    onEvent: PiEventCallback
  ): Promise<UserPISession> {
    const userSession: UserPISession = {
      sessionId: session.sessionId,
      userId,
      session,
      unsubscribe: () => {},
      workspacePath,
      agentCwd: agentCwdFromWorkspace(workspacePath),
      sessionDir,
      agentDir,
      isStreaming: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      onEvent,
      widgetHost: null as unknown as WebWidgetHost,
      extensionUiBridge: null as unknown as ExtensionUIBridge,
      extensionStatuses: new Map(),
    };
    // Close over `userSession`, not `session.sessionId` — runtime rebind can
    // change the Pi session id while keeping the same UserPISession shell.
    userSession.widgetHost = new WebWidgetHost((snapshot) => {
      userSession.onWidget?.(userId, snapshot);
    });
    userSession.extensionUiBridge = new ExtensionUIBridge((request) => {
      userSession.onExtensionUiRequest?.(userId, request);
    });

    const unsubscribe = session.subscribe((event) => userSession.onEvent(userId, event));
    userSession.unsubscribe = unsubscribe;

    this.sessions.set(session.sessionId, userSession);
    if (this.includeAdminSkillsFor(userId)) {
      userSession.adminSkillsExtended = true;
    }
    await this.bindWebExtensions(userSession);
    this.pushFooterSnapshot(userSession);

    return userSession;
  }

  private createRuntimeFactory(): CreateAgentSessionRuntimeFactory {
    return async (options) => {
      const services = await createAgentSessionServices({
        cwd: options.cwd,
        agentDir: options.agentDir,
        resourceLoaderOptions: getPlatformResourceLoaderOptions(),
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
      });
      return {
        session: result.session,
        services,
        diagnostics: services.diagnostics,
        modelFallbackMessage: result.modelFallbackMessage,
        extensionsResult: result.extensionsResult,
      };
    };
  }

  private async ensureRuntime(
    ps: UserPISession,
    options?: { skipExtensionBind?: boolean }
  ): Promise<AgentSessionRuntime> {
    if (ps.runtime) return ps.runtime;

    await loadPlatformSystemMd();
    const oldSessionId = ps.sessionId;
    const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(), {
      cwd: ps.agentCwd,
      agentDir: ps.agentDir,
      sessionManager: ps.session.sessionManager,
    });

    ps.unsubscribe();
    ps.session.dispose();
    ps.session = runtime.session;
    ps.sessionId = runtime.session.sessionId;
    ps.sessionDir = runtime.session.sessionManager.getSessionDir();
    ps.unsubscribe = runtime.session.subscribe((event) => ps.onEvent(ps.userId, event));
    if (oldSessionId !== ps.sessionId) {
      this.sessions.delete(oldSessionId);
      this.sessions.set(ps.sessionId, ps);
    }

    runtime.setRebindSession(async (session) => {
      const rebindOldSessionId = ps.sessionId;
      ps.unsubscribe();
      ps.session = session;
      ps.sessionId = session.sessionId;
      ps.sessionDir = session.sessionManager.getSessionDir();
      ps.unsubscribe = session.subscribe((event) => ps.onEvent(ps.userId, event));
      if (rebindOldSessionId !== session.sessionId) {
        this.sessions.delete(rebindOldSessionId);
        this.sessions.set(session.sessionId, ps);
      }
      await this.bindWebExtensions(ps);
    });

    if (!options?.skipExtensionBind) {
      await this.bindWebExtensions(ps);
    }
    ps.runtime = runtime;
    assertPlatformRulesLoaded(ps.session.systemPrompt);
    return runtime;
  }

  /** Public entry for orchestration (e.g. /btw fork flow). */
  async ensureRuntimeForSession(ps: UserPISession): Promise<AgentSessionRuntime> {
    return this.ensureRuntime(ps);
  }

  /** Remove a stale session id from the in-memory map (fork cleanup). */
  dropSessionRecord(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): UserPISession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionForUser(userId: string): UserPISession | undefined {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) return s;
    }
    return undefined;
  }

  async sendPrompt(sessionId: string, text: string, images?: { mediaType: string; data: string }[]) {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    ps.isStreaming = true;
    try {
      const promptOpts: any = {};
      if (images?.length) {
        await persistChatAttachments(ps.agentCwd, text, images);
        promptOpts.images = images.map((img) => ({
          type: "image" as const,
          mimeType: img.mediaType,
          data: img.data,
        }));
      }
      await ps.session.prompt(text, promptOpts);
    } finally {
      ps.isStreaming = false;
    }
  }

  async sendSteer(sessionId: string, text: string) {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    await ps.session.steer(text);
  }

  async sendFollowUp(sessionId: string, text: string) {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    await ps.session.followUp(text);
  }

  async abort(sessionId: string) {
    const ps = this.sessions.get(sessionId);
    if (!ps) return;
    await ps.session.abort();
    ps.isStreaming = false;
  }

  isStreaming(sessionId: string): boolean {
    return this.isAgentRunning(sessionId);
  }

  /** Whether the SDK agent loop is actively running (survives WS disconnect). */
  isAgentRunning(sessionId: string): boolean {
    const ps = this.sessions.get(sessionId);
    if (!ps) return false;
    try {
      return ps.session.isStreaming;
    } catch {
      return ps.isStreaming;
    }
  }

  getMessages(sessionId: string): any[] {
    const ps = this.sessions.get(sessionId);
    if (!ps) return [];
    return ps.session.messages;
  }

  // --- Slash command SDK wrappers ---

  getAvailableModels(sessionId: string): ModelRef[] {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const policy = this.policyForSession(ps);
    const models = ps.session.modelRegistry.getAvailable().map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name,
    }));
    return filterModels(policy, models);
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const policy = this.policyForSession(ps);
    if (!isModelAllowed(policy, provider, modelId)) {
      throw new Error(modelPolicyError(provider, modelId, policy.templateId));
    }
    const model = ps.session.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await ps.session.setModel(model);
  }

  async cycleModel(
    sessionId: string,
    direction?: "forward" | "backward"
  ): Promise<(ModelRef & { thinkingLevel: ThinkingLevel; isScoped: boolean }) | undefined> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const policy = this.policyForSession(ps);
    const result = await ps.session.cycleModel(direction);
    if (!result) return undefined;
    if (!isModelAllowed(policy, result.model.provider, result.model.id)) {
      throw new Error(modelPolicyError(result.model.provider, result.model.id, policy.templateId));
    }
    return {
      provider: result.model.provider,
      id: result.model.id,
      name: result.model.name,
      thinkingLevel: result.thinkingLevel,
      isScoped: result.isScoped,
    };
  }

  setScopedModels(sessionId: string, models: ScopedModelRef[]): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const policy = this.policyForSession(ps);
    const scopedModels = models.map((m) => {
      if (!isModelAllowed(policy, m.provider, m.id)) {
        throw new Error(modelPolicyError(m.provider, m.id, policy.templateId));
      }
      const model = ps.session.modelRegistry.find(m.provider, m.id);
      if (!model) throw new Error(`Model not found: ${m.provider}/${m.id}`);
      return { model, thinkingLevel: m.thinkingLevel };
    });
    ps.session.setScopedModels(scopedModels);
  }

  setThinkingLevel(sessionId: string, level: ThinkingLevel): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    ps.session.setThinkingLevel(level);
  }

  setSteeringMode(sessionId: string, mode: SteeringMode): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    ps.session.setSteeringMode(mode);
  }

  setFollowUpMode(sessionId: string, mode: FollowUpMode): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    ps.session.setFollowUpMode(mode);
  }

  setSessionName(sessionId: string, name: string): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    ps.session.setSessionName(name);
  }

  async compact(sessionId: string, customInstructions?: string): Promise<CompactionResult> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return await ps.session.compact(customInstructions);
  }

  getSessionStats(sessionId: string): SessionStats {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return ps.session.getSessionStats();
  }

  getSessionTree(sessionId: string): ClientTreeNode[] {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return mapSessionTree(ps.session.sessionManager.getTree(), ps.session.sessionManager.getLeafId());
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    }
  ): Promise<Awaited<ReturnType<AgentSession["navigateTree"]>>> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return await ps.session.navigateTree(targetId, options);
  }

  async runtimeNewSession(
    sessionId: string,
    options?: { parentSession?: string }
  ): Promise<{ cancelled: boolean; sessionId?: string }> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const runtime = await this.ensureRuntime(ps);
    const result = await runtime.newSession(options);
    if (result.cancelled) return { cancelled: true };
    return { cancelled: false, sessionId: ps.sessionId };
  }

  async runtimeResumeSession(
    sessionId: string,
    sessionPath: string,
    cwdOverride?: string
  ): Promise<{ cancelled: boolean; sessionId?: string }> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const runtime = await this.ensureRuntime(ps);
    const result = await runtime.switchSession(sessionPath, {
      cwdOverride: cwdOverride ?? ps.agentCwd,
    });
    if (result.cancelled) return { cancelled: true };
    return { cancelled: false, sessionId: ps.sessionId };
  }

  async runtimeForkSession(
    sessionId: string,
    entryId: string,
    position?: "before" | "at"
  ): Promise<{ cancelled: boolean; selectedText?: string; sessionId?: string }> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const runtime = await this.ensureRuntime(ps);
    const result = await runtime.fork(entryId, { position });
    if (result.cancelled) return { cancelled: true };
    return { cancelled: false, selectedText: result.selectedText, sessionId: ps.sessionId };
  }

  async exportToHtml(sessionId: string, outputPath?: string): Promise<string> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return await ps.session.exportToHtml(outputPath);
  }

  exportToJsonl(sessionId: string, outputPath?: string): string {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return ps.session.exportToJsonl(outputPath);
  }

  async runtimeImportFromJsonl(
    sessionId: string,
    inputPath: string,
    cwdOverride?: string
  ): Promise<{ cancelled: boolean }> {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    const runtime = await this.ensureRuntime(ps);
    return await runtime.importFromJsonl(inputPath, cwdOverride ?? ps.agentCwd);
  }

  getLastAssistantText(sessionId: string): string | undefined {
    const ps = this.sessions.get(sessionId);
    if (!ps) throw new Error("No active PI session");
    ps.lastActivity = Date.now();
    return ps.session.getLastAssistantText();
  }

  async removeSession(sessionId: string) {
    const ps = this.sessions.get(sessionId);
    if (ps?.runtime) {
      await ps.runtime.dispose();
    } else if (ps) {
      ps.unsubscribe();
      ps.session.dispose();
    }
    ps?.widgetHost.dispose();
    ps?.extensionUiBridge.dispose();
    this.sessions.delete(sessionId);
  }

  async disposeAll() {
    await Promise.all(
      Array.from(this.sessions.values()).map(async (ps) => {
        if (ps.runtime) {
          await ps.runtime.dispose();
        } else {
          ps.unsubscribe();
          ps.session.dispose();
        }
      })
    );
    this.sessions.clear();
  }
}
