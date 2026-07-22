export interface LoginResponse extends AccountProfile {
  sessionId: string;
}

export interface AccountProfile {
  userId: string;
  displayName: string;
  username: string;
  role: "user" | "admin";
  tokensUsed: number;
  budgetUsd: number | null;
  budgetUsedUsd: number;
  budgetRemainingUsd: number | null;
  budgetUnlimited: boolean;
}

export interface TokenUsage {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  used: number;
  budgetUsd: number | null;
  budgetUsedUsd: number;
  budgetRemainingUsd: number | null;
  budgetUnlimited: boolean;
  costTodayUsd?: number;
  costTodayBySource?: { chat: number; subagent: number };
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: number;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; tool: ToolCallRecord };

export interface ChatImageAttachment {
  mediaType: string;
  data: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCallRecord[];
  /** Interleaved content blocks (text + thinking + tool calls, in arrival order) */
  blocks?: ContentBlock[];
  /** Vision attachments on user messages */
  images?: ChatImageAttachment[];
  isStreaming?: boolean;
  /** Provider/API failure summarized for display (empty-content error turns). */
  error?: string;
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
}

export type EditorViewMode = "preview" | "edit";

export type EditorMediaType = "image" | "audio" | "video" | "pdf";

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  language: string;
  viewMode: EditorViewMode;
  mediaType?: EditorMediaType;
}
