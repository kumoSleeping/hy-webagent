/**
 * Broad category a tool belongs to, used to label a *collapsed group* of
 * consecutive tool calls (e.g. "Web" for a burst of read_url/search calls,
 * "Tools" for local bash/file-editing work) instead of a bare tool count.
 */
export type ToolCategory = "web" | "tools";

const WEB_TOOLS = new Set(["read_url", "fetch_url", "web_fetch", "parallel_search_web", "search_web", "web_search", "x_search"]);

export function getToolCategory(toolName: string): ToolCategory {
  const normalized = toolName.toLowerCase().replace(/-/g, "_");
  return WEB_TOOLS.has(normalized) ? "web" : "tools";
}

/** Stable user-facing labels for tools and native provider actions. */
export function getToolDisplayLabel(
  toolName: string,
  input?: Record<string, unknown>,
): string {
  const normalized = toolName.toLowerCase().replace(/-/g, "_");
  const actionType = typeof input?.type === "string" ? input.type.toLowerCase() : "";

  if (normalized === "web_search") {
    if (actionType === "open_page") return "Open Page";
    if (actionType === "find_in_page") return "Find on Page";
    return "Web Search";
  }

  const labels: Record<string, string> = {
    x_search: "X Search",
    code_interpreter: "Code Interpreter",
    view_image: "View Image",
    view_x_video: "View X Video",
    read_url: "Read URL",
    fetch_url: "Fetch URL",
    web_fetch: "Web Fetch",
    parallel_search_web: "Parallel Web Search",
    search_web: "Web Search",
  };
  return labels[normalized] ?? toolName;
}

/** True when streamed tool chunks were corrupted by String(object). */
export function isGarbageToolOutput(output: string | undefined): boolean {
  if (!output?.trim()) return false;
  return /^(\[object Object\])+$/i.test(output.trim());
}

/** Normalize tool result payloads (string, content blocks, objects) to display text. */
export function formatToolContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return JSON.stringify(item, null, 2);
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if ("content" in obj) return formatToolContent(obj.content);
    if ("text" in obj) return String(obj.text);
    if ("output" in obj) return formatToolContent(obj.output);
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

/** Resolve the best available result text for a tool call card. */
export function resolveToolOutput(
  output: string | undefined,
  details: Record<string, unknown> | undefined
): string {
  if (output && output.trim()) return output;
  if (!details) return "";
  return formatToolContent(details.content ?? details.result ?? details);
}

/**
 * Human-readable one-line summary of what the tool is doing.
 * Corner badge already shows the tool name — body should show the target/action.
 */
export function extractToolTarget(
  toolName: string,
  input: Record<string, unknown> | undefined
): string {
  if (!input || Object.keys(input).length === 0) return "…";

  const normalized = toolName.toLowerCase().replace(/-/g, "_");

  switch (normalized) {
    case "bash": {
      const cmd = input.command as string | undefined;
      return cmd?.trim() || "shell command";
    }
    case "edit": {
      const path = pickPath(input);
      const oldText = (input.oldText ?? input.old_text ?? input.oldString) as string | undefined;
      const short = oldText ? oldText.slice(0, 60).replace(/\n/g, "↵") : "";
      return path ? `${path}${short ? ` — "${short}…"` : ""}` : "edit file";
    }
    case "write":
    case "read": {
      const path = pickPath(input);
      return path || `${normalized} file`;
    }
    case "read_url":
    case "fetch_url":
    case "web_fetch": {
      const url = pickUrl(input);
      return url || "fetch URL";
    }
    case "parallel_search_web":
    case "search_web":
    case "web_search":
    case "x_search": {
      const actionType = typeof input.type === "string" ? input.type : "";
      if (actionType === "open_page") return pickUrl(input) || "open page";
      if (actionType === "find_in_page") {
        const needle = input.pattern ?? input.query;
        return needle ? `"${truncate(String(needle), 80)}"` : pickUrl(input) || "find on page";
      }
      return summarizeSearches(input);
    }
    case "grep":
    case "search": {
      const pattern = (input.pattern ?? input.query) as string | undefined;
      return pattern ? `"${truncate(pattern, 80)}"` : "search pattern";
    }
    case "find": {
      const path = pickPath(input);
      return path ? `find in ${path}` : "find files";
    }
    case "ls": {
      const path = pickPath(input);
      return path || "list directory";
    }
    case "subagent_explorer":
    case "subagent_searcher":
    case "subagent_worker": {
      const task = (input.task ?? input.prompt ?? input.message) as string | undefined;
      return task ? `${normalized.replace("subagent_", "")} · "${truncate(task, 80)}"` : normalized.replace("subagent_", "");
    }
    default:
      return extractGenericTarget(input) || "…";
  }
}

function pickPath(input: Record<string, unknown>): string | undefined {
  const path = input.path ?? input.file_path ?? input.filePath ?? input.file;
  return path ? String(path) : undefined;
}

function pickUrl(input: Record<string, unknown>): string | undefined {
  const url = input.url ?? input.uri ?? input.link ?? input.href;
  return url ? truncate(String(url), 120) : undefined;
}

function summarizeSearches(input: Record<string, unknown>): string {
  const searches = input.searches;
  if (!Array.isArray(searches) || searches.length === 0) {
    const query = input.query ?? input.q;
    if (!query) return "web search";
    const sourceCount = Array.isArray(input.sources) ? input.sources.length : 0;
    return `"${truncate(String(query), 80)}"${sourceCount > 0 ? ` · ${sourceCount} sources` : ""}`;
  }

  const queries = searches
    .map((s) => {
      if (typeof s === "string") return s;
      if (s && typeof s === "object" && "query" in s) return String((s as { query?: unknown }).query ?? "");
      return "";
    })
    .filter(Boolean);

  if (queries.length === 0) return `${searches.length} searches`;
  const head = queries.slice(0, 2).map((q) => `"${truncate(q, 48)}"`).join(" · ");
  const extra = queries.length > 2 ? ` +${queries.length - 2}` : "";
  return head + extra;
}

function extractGenericTarget(input: Record<string, unknown>): string | undefined {
  const url = pickUrl(input);
  if (url) return url;

  const path = pickPath(input);
  if (path) return path;

  for (const key of ["query", "q", "search", "command", "prompt", "message", "text", "name", "title"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return truncate(value, 120);
  }

  if (Array.isArray(input.searches) && input.searches.length > 0) {
    return summarizeSearches(input);
  }

  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) return truncate(value, 120);
  }

  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
