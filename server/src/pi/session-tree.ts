import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { formatThinkingLevel } from "./thinking-level.js";

/** Raw tree node returned by the pi SDK's SessionManager.getTree(). */
type SdkTreeNode = ReturnType<SessionManager["getTree"]>[number];

/** Matches the CLI `/tree` filter modes. Web uses `default` for now. */
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

/**
 * Tree node shape consumed by the web client (SlashSessionTree).
 * Mirrors the CLI tree browser's default filter: user/assistant text turns,
 * tool results, bash executions, custom extension messages, branch summaries,
 * and compactions are visible; bookkeeping entries (labels, model/thinking
 * changes, session_info, opaque custom entries) are flattened away.
 */
export interface ClientTreeNode {
  id: string;
  role: "user" | "assistant" | "tool" | "bash" | "custom" | "summary" | "compaction";
  preview: string;
  /** User/auto-assigned label resolved for this entry, if any. */
  label?: string;
  children: ClientTreeNode[];
}

const PREVIEW_MAX = 160;

type ToolCallInfo = { name: string; arguments: Record<string, unknown> };

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat;
}

function normalizeInline(text: string): string {
  return text.replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim();
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join(" ");
  }
  return "";
}

function hasTextContent(content: unknown): boolean {
  return extractTextContent(content).trim().length > 0;
}

function shortenPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

/** Same formatting as the CLI tree browser's `formatToolCall`. */
function formatToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read": {
      const path = shortenPath(String(args.path || args.file_path || ""));
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let display = path;
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + (limit as number) - 1 : "";
        display += `:${start}${end ? `-${end}` : ""}`;
      }
      return `[read: ${display}]`;
    }
    case "write":
      return `[write: ${shortenPath(String(args.path || args.file_path || ""))}]`;
    case "edit":
      return `[edit: ${shortenPath(String(args.path || args.file_path || ""))}]`;
    case "bash": {
      const rawCmd = String(args.command || "");
      const cmd = normalizeInline(rawCmd).slice(0, 50);
      return `[bash: ${cmd}${rawCmd.length > 50 ? "..." : ""}]`;
    }
    case "grep":
      return `[grep: /${String(args.pattern || "")}/ in ${shortenPath(String(args.path || "."))}]`;
    case "find":
      return `[find: ${String(args.pattern || "")} in ${shortenPath(String(args.path || "."))}]`;
    case "ls":
      return `[ls: ${shortenPath(String(args.path || "."))}]`;
    default: {
      const argsStr = JSON.stringify(args).slice(0, 40);
      return `[${name}: ${argsStr}${JSON.stringify(args).length > 40 ? "..." : ""}]`;
    }
  }
}

/** Walk the SDK tree once so tool-result rows can resolve their call name/args. */
export function buildToolCallMap(nodes: SdkTreeNode[]): Map<string, ToolCallInfo> {
  const map = new Map<string, ToolCallInfo>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const entry = node.entry;
    if (entry.type === "message" && entry.message.role === "assistant") {
      const content = (entry.message as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            (block as { type?: string }).type === "toolCall"
          ) {
            const tc = block as { id: string; name: string; arguments?: Record<string, unknown> };
            map.set(tc.id, { name: tc.name, arguments: tc.arguments ?? {} });
          }
        }
      }
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return map;
}

function isSettingsEntry(entry: SessionEntry): boolean {
  return (
    entry.type === "label" ||
    entry.type === "custom" ||
    entry.type === "model_change" ||
    entry.type === "thinking_level_change" ||
    entry.type === "session_info"
  );
}

function passesFilterMode(
  node: SdkTreeNode,
  entry: SessionEntry,
  filterMode: TreeFilterMode
): boolean {
  const isSettings = isSettingsEntry(entry);
  switch (filterMode) {
    case "user-only":
      return entry.type === "message" && entry.message.role === "user";
    case "no-tools":
      return !isSettings && !(entry.type === "message" && entry.message.role === "toolResult");
    case "labeled-only":
      return node.label !== undefined;
    case "all":
      return true;
    default:
      return !isSettings;
  }
}

function assistantPreview(
  entry: Extract<SessionEntry, { type: "message" }>,
  isCurrentLeaf: boolean
): string | null {
  const msg = entry.message as {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
  if (msg.role !== "assistant") return null;

  const text = extractTextContent(msg.content).trim();
  if (text) return clip(text);

  if (isCurrentLeaf) return "(no text)";

  const isErrorOrAborted =
    msg.stopReason && msg.stopReason !== "stop" && msg.stopReason !== "toolUse";
  if (!isErrorOrAborted) return null;

  if (msg.stopReason === "aborted") return "(aborted)";
  if (msg.errorMessage) return clip(normalizeInline(msg.errorMessage));
  return "(no content)";
}

function mapEntryPreview(
  entry: SessionEntry,
  toolCallMap: Map<string, ToolCallInfo>,
  isCurrentLeaf: boolean
): { role: ClientTreeNode["role"]; preview: string } | null {
  if (entry.type === "message") {
    const role = (entry.message as { role?: string }).role;
    if (role === "user") {
      const text = extractTextContent((entry.message as { content?: unknown }).content).trim();
      return { role: "user", preview: text ? clip(text) : "(empty)" };
    }
    if (role === "assistant") {
      const preview = assistantPreview(entry, isCurrentLeaf);
      return preview ? { role: "assistant", preview } : null;
    }
    if (role === "toolResult") {
      const msg = entry.message as {
        toolCallId?: string;
        toolName?: string;
      };
      const toolCall = msg.toolCallId ? toolCallMap.get(msg.toolCallId) : undefined;
      const preview = toolCall
        ? formatToolCall(toolCall.name, toolCall.arguments)
        : `[${msg.toolName ?? "tool"}]`;
      return { role: "tool", preview };
    }
    if (role === "bashExecution") {
      const cmd = normalizeInline(String((entry.message as { command?: string }).command ?? ""));
      return { role: "bash", preview: `[bash]: ${cmd || "(empty)"}` };
    }
    return isCurrentLeaf ? { role: "assistant", preview: `[${role}]` } : null;
  }

  if (entry.type === "custom_message") {
    const content = extractTextContent(entry.content).trim();
    return {
      role: "custom",
      preview: `[${entry.customType}]: ${content ? clip(content) : "(empty)"}`,
    };
  }

  if (entry.type === "branch_summary") {
    return { role: "summary", preview: clip(entry.summary) };
  }

  if (entry.type === "compaction") {
    const tokens = Math.round(entry.tokensBefore / 1000);
    return { role: "compaction", preview: `[compaction: ${tokens}k tokens] ${clip(entry.summary)}` };
  }

  return null;
}

function mapBookkeepingPreview(entry: SessionEntry): { role: ClientTreeNode["role"]; preview: string } | null {
  switch (entry.type) {
    case "model_change":
      return { role: "custom", preview: `[model: ${entry.modelId}]` };
    case "thinking_level_change":
      return { role: "custom", preview: `[thinking: ${formatThinkingLevel(entry.thinkingLevel)}]` };
    case "custom":
      return { role: "custom", preview: `[custom: ${entry.customType}]` };
    case "label":
      return { role: "custom", preview: `[label: ${entry.label ?? "(cleared)"}]` };
    case "session_info":
      return { role: "custom", preview: entry.name ? `[title: ${entry.name}]` : "[title: empty]" };
    default:
      return null;
  }
}

/**
 * Convert the SDK session tree into the client contract. Default mode matches
 * the CLI tree browser: tool results and bash executions are first-class rows,
 * assistant turns that only contain tool calls are hidden (unless they're the
 * current leaf), and bookkeeping entries are flattened while lifting children.
 */
export function mapSessionTree(
  nodes: SdkTreeNode[],
  currentLeafId?: string | null,
  filterMode: TreeFilterMode = "default",
  toolCallMap: Map<string, ToolCallInfo> = buildToolCallMap(nodes)
): ClientTreeNode[] {
  const out: ClientTreeNode[] = [];
  for (const node of nodes) {
    const entry = node.entry;
    const isCurrentLeaf = entry.id === currentLeafId;
    const children = mapSessionTree(node.children ?? [], currentLeafId, filterMode, toolCallMap);

    if (!passesFilterMode(node, entry, filterMode)) {
      out.push(...children);
      continue;
    }

    if (filterMode !== "all" && isSettingsEntry(entry)) {
      out.push(...children);
      continue;
    }

    const mapped =
      filterMode === "all" && isSettingsEntry(entry)
        ? mapBookkeepingPreview(entry)
        : mapEntryPreview(entry, toolCallMap, isCurrentLeaf);
    if (!mapped) {
      out.push(...children);
      continue;
    }

    out.push({
      id: entry.id,
      role: mapped.role,
      preview: mapped.preview,
      label: node.label,
      children,
    });
  }
  return out;
}
