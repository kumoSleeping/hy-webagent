import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatch } from "../slash/router.js";
import { resolveWorkspacePath } from "../slash/types.js";
import type { PISessionManager } from "../pi/session-manager.js";
import * as sessionFiles from "../pi/session-files.js";

function createMockAgentSession() {
  return {
    model: { provider: "anthropic", id: "claude-sonnet-4" },
    modelRegistry: {
      find: vi.fn().mockImplementation((provider: string, id: string) => {
        if (provider === "anthropic" && id === "claude-sonnet-4") {
          return { provider, id, name: "Claude Sonnet 4" };
        }
        return undefined;
      }),
    },
    setModel: vi.fn().mockResolvedValue(undefined),
    setScopedModels: vi.fn(),
    setThinkingLevel: vi.fn(),
    getAvailableThinkingLevels: vi.fn().mockReturnValue(["off", "minimal", "low", "medium", "high", "xhigh"]),
    thinkingLevel: "medium",
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    setSessionName: vi.fn(),
    compact: vi.fn().mockResolvedValue({ summary: "compact summary" }),
    navigateTree: vi.fn().mockResolvedValue({ cancelled: false }),
    getSessionStats: vi.fn().mockReturnValue({
      sessionId: "sess-1",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
      cost: 0.001,
    }),
    getLastAssistantText: vi.fn().mockReturnValue("last assistant text"),
    exportToHtml: vi.fn().mockResolvedValue("/tmp/export.html"),
    exportToJsonl: vi.fn().mockReturnValue("/tmp/export.jsonl"),
    sessionManager: {
      getTree: vi.fn().mockReturnValue([]),
      getLeafId: vi.fn().mockReturnValue("leaf-1"),
      createBranchedSession: vi.fn().mockReturnValue("/tmp/workspace/.pi/sessions/sess-fork.jsonl"),
    },
    settingsManager: {
      setDefaultThinkingLevel: vi.fn(),
      setSteeringMode: vi.fn(),
      setFollowUpMode: vi.fn(),
      setCompactionEnabled: vi.fn(),
      setRetryEnabled: vi.fn(),
      setAutoRetryEnabled: vi.fn(),
      setHideThinkingBlock: vi.fn(),
      setTheme: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createMockSessionManager(overrides: Partial<PISessionManager> = {}): PISessionManager {
  const session = createMockAgentSession();
  const userSession = { session, sessionId: "sess-1", workspacePath: "/tmp/workspace" };
  return {
    getAvailableModels: vi.fn().mockReturnValue([
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ]),
    setModel: vi.fn().mockResolvedValue(undefined),
    cycleModel: vi.fn().mockResolvedValue({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      thinkingLevel: "medium",
      isScoped: false,
    }),
    newSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-2" }),
    runtimeNewSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-2" }),
    runtimeResumeSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-old" }),
    runtimeForkSession: vi.fn().mockResolvedValue({ cancelled: false, sessionId: "sess-fork" }),
    runtimeImportFromJsonl: vi.fn().mockResolvedValue({ cancelled: false }),
    getSession: vi.fn().mockReturnValue(userSession),
    getSessionForUser: vi.fn().mockReturnValue(userSession),
    ...overrides,
  } as unknown as PISessionManager;
}

describe("slash command router", () => {
  let sessionManager: PISessionManager;
  const workspacePath = "/tmp/workspace";
  const userId = "user-1";
  const activeSessionId = "sess-1";

  beforeEach(() => {
    sessionManager = createMockSessionManager();
  });

  it("returns error for unknown command", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "unknown.command" as any, args: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unknown slash command");
  });

  it("model.set validates model exists", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "model.set", args: { provider: "anthropic", modelId: "claude-sonnet-4" } }
    );
    expect(result.ok).toBe(true);
    const session = (sessionManager.getSession as any).mock.results[0].value.session;
    expect(session.setModel).toHaveBeenCalled();
    expect(session.setThinkingLevel).toHaveBeenCalledWith("xhigh");
  });

  it("settings.set validates thinking level", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "settings.set", args: { key: "thinkingLevel", value: "invalid" } }
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid thinkingLevel");
  });

  it("session.name requires name", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.name", args: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("name is required");
  });

  it("session.stats returns stats", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.stats", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("sessionId");
  });

  it("session.compact returns success", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.compact", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Session compacted");
  });

  it("session.copy returns last assistant text", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.copy", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ text: "last assistant text" });
  });

  it("session.exportJsonl returns file path", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.exportJsonl", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ filePath: "/tmp/export.jsonl" });
  });

  it("session.new calls runtimeNewSession", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.new", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(sessionManager.runtimeNewSession).toHaveBeenCalledWith("sess-1", undefined);
    expect(result.data).toEqual({ sessionId: "sess-2" });
  });

  it("session.resume calls runtimeResumeSession with Pi session file path", async () => {
    vi.spyOn(sessionFiles, "findSessionFilePath").mockResolvedValue(
      "/tmp/workspace/.pi/sessions/2024-01-01T00-00-00_sess-old.jsonl"
    );
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.resume", args: { sessionId: "sess-old" } }
    );
    expect(result.ok).toBe(true);
    expect(sessionManager.runtimeResumeSession).toHaveBeenCalledWith(
      "sess-1",
      "/tmp/workspace/.pi/sessions/2024-01-01T00-00-00_sess-old.jsonl",
      "/tmp/workspace/projects"
    );
    expect(result.data).toEqual({ sessionId: "sess-old" });
  });

  it("session.fork calls runtimeForkSession with last user message", async () => {
    const userSession = (sessionManager.getSession as any)("sess-1");
    userSession.session.getUserMessagesForForking = vi.fn().mockReturnValue([
      { entryId: "user-msg-1", text: "hello" },
    ]);
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.fork", args: {} }
    );
    expect(result.ok).toBe(true);
    expect(sessionManager.runtimeForkSession).toHaveBeenCalledWith("sess-1", "user-msg-1", undefined);
    expect(result.data).toEqual({ sessionId: "sess-fork" });
  });

  it("session.tree returns currentEntryId", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.tree", args: {} }
    );
    expect(result.ok).toBe(true);
    expect((result.data as any).currentEntryId).toBe("leaf-1");
  });

  it("session.importJsonl calls runtimeImportFromJsonl", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "session.importJsonl", args: { sourcePath: "export.jsonl" } }
    );
    expect(result.ok).toBe(true);
    expect(sessionManager.runtimeImportFromJsonl).toHaveBeenCalled();
  });

  it("model.setScoped calls session.setScopedModels", async () => {
    const result = await dispatch(
      { userId, workspacePath, activeSessionId, sessionManager },
      { command: "model.setScoped", args: { models: [{ provider: "anthropic", modelId: "claude-sonnet-4" }] } }
    );
    expect(result.ok).toBe(true);
    expect(sessionManager.getSession(activeSessionId)?.session.setScopedModels).toHaveBeenCalled();
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves paths inside workspace", () => {
    expect(resolveWorkspacePath("/tmp/ws", "sessions/foo.jsonl")).toBe("/tmp/ws/sessions/foo.jsonl");
  });

  it("rejects path traversal", () => {
    expect(() => resolveWorkspacePath("/tmp/ws", "../etc/passwd")).toThrow("Path traversal denied");
  });
});
