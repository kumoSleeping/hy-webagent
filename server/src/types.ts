// ============================================================
// PI Web Platform - Shared Types
// ============================================================

export type UserRole = "user" | "admin" | "bot";

/** User account stored in memory/file */
export interface UserAccount {
  userId: string;
  apiKeyHash: string;
  /** Opaque HMAC fingerprint for O(1) API key lookup — never expose to clients. */
  apiKeyLookup?: string;
  displayName: string;
  /** Login handle; defaults to displayName when omitted. */
  username?: string;
  /** Admin users load platform admin-skills/ into their agent sessions. */
  role?: UserRole;
  createdAt: number;
  /** Cumulative token count (usage telemetry only; budgetUsd enforces limits). */
  tokensUsed: number;
  /** Total spend cap in USD; `null` = unlimited (default for admin). */
  budgetUsd: number | null;
  /** Cumulative spend in USD. */
  budgetUsedUsd: number;
  /** Custom system prompt override for this user */
  systemPrompt?: string;
  /**
   * Human-readable workspace folder name (slugified display name + random
   * suffix), e.g. "alice-4f8k29xa". Set once at account creation and never
   * recomputed, so the on-disk workspace path stays stable even if the
   * display name changes later. Falls back to `userId` for accounts created
   * before this field existed (lazily backfilled on first access).
   */
  workspaceDir?: string;
  /** Model access template id; null/undefined/"full" = unrestricted when modelAllow is unset. */
  modelTemplateId?: string | null;
  /** Per-user model allowlist; takes precedence over modelTemplateId. null/undefined = no custom filter. */
  modelAllow?: Array<{ provider: string; modelId: string }> | null;
}

/** Authenticated user session (in-memory, not JWT) */
export interface UserSession {
  sessionId: string;
  userId: string;
  displayName: string;
  username: string;
  role: UserRole;
  createdAt: number;
  lastActivity: number;
  /** Hard expiry — session invalid after this timestamp regardless of activity. */
  expiresAt: number;
}

/** Token usage record */
export interface TokenUsageRecord {
  timestamp: number;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

/** Per-user PI agent state */
export interface UserAgentState {
  userId: string;
  workspacePath: string;
  skillsPath: string;
  isStreaming: boolean;
  lastActivity: number;
}

/** WebSocket message types */
export enum WSMessageType {
  // Chat
  CHAT_PROMPT = "chat:prompt",
  CHAT_STEER = "chat:steer",
  CHAT_FOLLOWUP = "chat:followup",
  CHAT_ABORT = "chat:abort",
  CHAT_TEXT_DELTA = "chat:text_delta",
  CHAT_THINKING_DELTA = "chat:thinking_delta",
  CHAT_TOOL_START = "chat:tool_start",
  CHAT_TOOL_UPDATE = "chat:tool_update",
  CHAT_TOOL_END = "chat:tool_end",
  CHAT_AGENT_START = "chat:agent_start",
  CHAT_AGENT_END = "chat:agent_end",
  CHAT_ERROR = "chat:error",
  // Steering/follow-up messages queued while the agent is running but not
  // yet actually seen by the model — see PISessionManager.getQueuedMessages.
  CHAT_QUEUE_UPDATE = "chat:queue_update",
  CHAT_DEQUEUE = "chat:dequeue",
  CHAT_DEQUEUED = "chat:dequeued",

  // Terminal
  TERM_INPUT = "term:input",
  TERM_OUTPUT = "term:output",
  TERM_RESIZE = "term:resize",
  TERM_CLOSE = "term:close",

  // File operations
  FILE_LIST = "file:list",
  FILE_READ = "file:read",
  FILE_WRITE = "file:write",
  FILE_DELETE = "file:delete",
  FILE_CREATE_DIR = "file:create_dir",

  // System
  TOKEN_UPDATE = "token:update",
  ERROR = "error",
  AUTH_ERROR = "auth:error",
}

/** Base WebSocket message */
export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
}

/** Chat message types */
export interface ChatPromptPayload {
  text: string;
  images?: { mediaType: string; data: string }[];
}

export interface ChatTextDeltaPayload {
  delta: string;
}

export interface ChatThinkingDeltaPayload {
  delta: string;
}

export interface ChatToolStartPayload {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ChatToolUpdatePayload {
  toolCallId: string;
  output: string;
}

export interface ChatToolEndPayload {
  toolCallId: string;
  isError: boolean;
  details?: Record<string, unknown>;
}

export interface TokenUpdatePayload {
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
}

/** File operation payloads */
export interface FileListPayload {
  path: string;
}

export interface FileReadPayload {
  path: string;
}

export interface FileWritePayload {
  path: string;
  content: string;
}

export interface FileDeletePayload {
  path: string;
}

export interface FileCreateDirPayload {
  path: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: number;
}

/** Terminal payloads */
export interface TermInputPayload {
  data: string;
}

export interface TermOutputPayload {
  data: string;
}

export interface TermResizePayload {
  cols: number;
  rows: number;
}

/** Login/Register payloads */
export interface LoginPayload {
  apiKey: string;
}

export interface LoginResponse {
  success: boolean;
  sessionId?: string;
  userId?: string;
  displayName?: string;
  tokensUsed?: number;
  error?: string;
}

/** Admin: create user */
export interface CreateUserPayload {
  adminKey: string;
  apiKey: string;
  displayName: string;
}
