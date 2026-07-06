import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentCwdFromWorkspace,
  agentDirFromWorkspace,
  ensureUserAgentDir,
  findLastUsedModelFromSessions,
  mergeBundledPackagesIntoSettings,
  migrateLegacyMemoryFiles,
  normalizeProjectsRelativePath,
  syncAgentExtensionsFromGlobal,
  syncBundledAgentExtensions,
  USER_PROJECTS_DIR,
} from "../pi/isolation.js";

describe("WorkspaceIsolator paths", () => {
  it("maps agent cwd to the projects subfolder", () => {
    expect(USER_PROJECTS_DIR).toBe("projects");
    expect(agentCwdFromWorkspace("/tmp/workspaces/user-abc")).toBe(
      "/tmp/workspaces/user-abc/projects"
    );
  });

  it("normalizes redundant projects/ prefixes", () => {
    expect(normalizeProjectsRelativePath("report.pdf")).toBe("report.pdf");
    expect(normalizeProjectsRelativePath("projects/report.pdf")).toBe("report.pdf");
    expect(normalizeProjectsRelativePath("/projects/a/b.md")).toBe("a/b.md");
    expect(normalizeProjectsRelativePath("projects/projects/nested.md")).toBe("nested.md");
  });

  it("maps agent dir to workspace/.pi/agent", () => {
    expect(agentDirFromWorkspace("/tmp/workspaces/user-abc")).toBe(
      "/tmp/workspaces/user-abc/.pi/agent"
    );
  });
});

describe("migrateLegacyMemoryFiles", () => {
  it("moves root Memories.md into projects/", async () => {
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ws-"));
    try {
      await fs.mkdir(path.join(userDir, "projects"), { recursive: true });
      await fs.writeFile(path.join(userDir, "Memories.md"), "legacy memory");

      await migrateLegacyMemoryFiles(userDir);

      await expect(fs.access(path.join(userDir, "Memories.md"))).rejects.toThrow();
      await expect(
        fs.readFile(path.join(userDir, "projects", "Memories.md"), "utf-8")
      ).resolves.toBe("legacy memory");
    } finally {
      await fs.rm(userDir, { recursive: true, force: true });
    }
  });

  it("drops legacy root copy when projects/ already has the file", async () => {
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ws-"));
    try {
      await fs.mkdir(path.join(userDir, "projects"), { recursive: true });
      await fs.writeFile(path.join(userDir, "Memories.md"), "old root");
      await fs.writeFile(path.join(userDir, "projects", "Memories.md"), "keep projects");

      await migrateLegacyMemoryFiles(userDir);

      await expect(fs.access(path.join(userDir, "Memories.md"))).rejects.toThrow();
      await expect(
        fs.readFile(path.join(userDir, "projects", "Memories.md"), "utf-8")
      ).resolves.toBe("keep projects");
    } finally {
      await fs.rm(userDir, { recursive: true, force: true });
    }
  });
});

describe("findLastUsedModelFromSessions", () => {
  it("returns the latest model_change across session files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-sessions-"));
    try {
      const sessionsDir = path.join(root, ".pi", "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "a.jsonl"),
        [
          '{"type":"model_change","timestamp":"2026-07-01T10:00:00.000Z","provider":"anthropic","modelId":"old"}',
          '{"type":"model_change","timestamp":"2026-07-01T12:00:00.000Z","provider":"anthropic","modelId":"newer"}',
        ].join("\n")
      );
      await fs.writeFile(
        path.join(sessionsDir, "b.jsonl"),
        '{"type":"model_change","timestamp":"2026-07-02T01:00:00.000Z","provider":"deepseek","modelId":"latest"}'
      );

      await expect(findLastUsedModelFromSessions(sessionsDir)).resolves.toEqual({
        provider: "deepseek",
        modelId: "latest",
        timestamp: "2026-07-02T01:00:00.000Z",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureUserAgentDir", () => {
  it("creates per-user agent dir and restores last model from sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-"));
    try {
      const sessionsDir = path.join(root, ".pi", "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "s.jsonl"),
        '{"type":"model_change","timestamp":"2026-07-02T01:00:00.000Z","provider":"kimi-coding","modelId":"k2p7"}'
      );

      const agentDir = await ensureUserAgentDir(root);
      expect(agentDir).toBe(path.join(root, ".pi", "agent"));

      const settings = JSON.parse(
        await fs.readFile(path.join(agentDir, "settings.json"), "utf-8")
      );
      expect(settings.defaultProvider).toBe("kimi-coding");
      expect(settings.defaultModel).toBe("k2p7");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("re-seeds empty auth.json from host on workspace init", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-empty-"));
    const previousHome = process.env.HOME;
    try {
      const fakeHome = path.join(root, "home");
      const globalAuth = path.join(fakeHome, ".pi", "agent", "auth.json");
      await fs.mkdir(path.dirname(globalAuth), { recursive: true });
      await fs.writeFile(
        globalAuth,
        JSON.stringify({ deepseek: { type: "api_key", key: "sk-test" } }, null, 2)
      );
      process.env.HOME = fakeHome;

      const workspace = path.join(root, "workspace");
      const agentDir = agentDirFromWorkspace(workspace);
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(path.join(agentDir, "auth.json"), "{}\n");

      await ensureUserAgentDir(workspace, { seedAuthFromGlobal: true });
      const auth = JSON.parse(
        await fs.readFile(path.join(agentDir, "auth.json"), "utf-8")
      ) as Record<string, { key?: string }>;
      expect(auth.deepseek?.key).toBe("sk-test");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("seeds jina from host auth.json without copying other providers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-jina-"));
    const previousHome = process.env.HOME;
    try {
      const fakeHome = path.join(root, "home");
      const globalAuth = path.join(fakeHome, ".pi", "agent", "auth.json");
      await fs.mkdir(path.dirname(globalAuth), { recursive: true });
      await fs.writeFile(
        globalAuth,
        JSON.stringify(
          {
            deepseek: { type: "api_key", key: "sk-host-only" },
            jina: { type: "api_key", key: "jina_test_key" },
          },
          null,
          2
        )
      );
      process.env.HOME = fakeHome;

      const agentDir = await ensureUserAgentDir(path.join(root, "workspace"), {
        seedAuthFromGlobal: false,
      });
      const auth = JSON.parse(
        await fs.readFile(path.join(agentDir, "auth.json"), "utf-8")
      ) as Record<string, { key?: string }>;
      expect(auth.jina?.key).toBe("jina_test_key");
      expect(auth.deepseek).toBeUndefined();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing per-user settings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-agent-"));
    try {
      const agentDir = path.join(root, ".pi", "agent");
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "settings.json"),
        JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4" })
      );

      await ensureUserAgentDir(root);

      const settings = JSON.parse(
        await fs.readFile(path.join(agentDir, "settings.json"), "utf-8")
      );
      expect(settings.defaultProvider).toBe("openai");
      expect(settings.defaultModel).toBe("gpt-4");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("syncAgentExtensionsFromGlobal", () => {
  it("copies missing extensions from the host agent dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ext-"));
    try {
      const globalDir = path.join(root, "global");
      const agentDir = path.join(root, "workspace", ".pi", "agent");
      const globalExtensions = path.join(globalDir, "extensions");
      await fs.mkdir(globalExtensions, { recursive: true });
      await fs.writeFile(path.join(globalExtensions, "status-bar.ts"), "export default function () {}");
      await fs.mkdir(path.join(globalExtensions, "nested"), { recursive: true });
      await fs.writeFile(path.join(globalExtensions, "nested", "index.ts"), "export {}");

      await syncAgentExtensionsFromGlobal(agentDir, globalDir);

      await expect(
        fs.readFile(path.join(agentDir, "extensions", "status-bar.ts"), "utf-8")
      ).resolves.toBe("export default function () {}");
      await expect(
        fs.readFile(path.join(agentDir, "extensions", "nested", "index.ts"), "utf-8")
      ).resolves.toBe("export {}");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("updates stale copies when the host extension is newer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ext-"));
    try {
      const globalDir = path.join(root, "global");
      const agentDir = path.join(root, "workspace", ".pi", "agent");
      const globalExtensions = path.join(globalDir, "extensions");
      const target = path.join(agentDir, "extensions", "status-bar.ts");
      await fs.mkdir(globalExtensions, { recursive: true });
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "export default function old() {}");
      await fs.writeFile(path.join(globalExtensions, "status-bar.ts"), "export default function new() {}");

      const oldMtime = new Date(Date.now() - 60_000);
      await fs.utimes(target, oldMtime, oldMtime);

      await syncAgentExtensionsFromGlobal(agentDir, globalDir);

      await expect(fs.readFile(target, "utf-8")).resolves.toBe("export default function new() {}");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves workspace-only extensions not present on the host", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ext-"));
    try {
      const globalDir = path.join(root, "global");
      const agentDir = path.join(root, "workspace", ".pi", "agent");
      const localOnly = path.join(agentDir, "extensions", "local-only.ts");
      await fs.mkdir(path.join(globalDir, "extensions"), { recursive: true });
      await fs.mkdir(path.dirname(localOnly), { recursive: true });
      await fs.writeFile(localOnly, "export default function local() {}");

      await syncAgentExtensionsFromGlobal(agentDir, globalDir);

      await expect(fs.readFile(localOnly, "utf-8")).resolves.toBe("export default function local() {}");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runs during ensureUserAgentDir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ext-"));
    try {
      const agentDir = await ensureUserAgentDir(path.join(root, "workspace"));

      await expect(
        fs.readFile(path.join(agentDir, "extensions", "goal-h.ts"), "utf-8")
      ).resolves.toContain("goal-manager-lite");

      const settings = JSON.parse(
        await fs.readFile(path.join(agentDir, "settings.json"), "utf-8")
      ) as { packages?: string[] };
      expect(settings.packages?.some((p) => p.endsWith("pi-subagents-h"))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("syncBundledAgentExtensions", () => {
  it("copies repo pi-extensions into the user agent dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-bundled-"));
    try {
      const agentDir = path.join(root, ".pi", "agent");
      await syncBundledAgentExtensions(agentDir);
      await expect(
        fs.readFile(path.join(agentDir, "extensions", "goal-h.ts"), "utf-8")
      ).resolves.toContain("goal_manager");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("mergeBundledPackagesIntoSettings", () => {
  it("adds pi-subagents-h package path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-pkg-"));
    try {
      const settingsPath = path.join(root, "settings.json");
      await fs.writeFile(settingsPath, JSON.stringify({ defaultModel: "x" }, null, 2));
      await mergeBundledPackagesIntoSettings(settingsPath);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as {
        defaultModel?: string;
        packages?: string[];
      };
      expect(settings.defaultModel).toBe("x");
      expect(settings.packages?.some((p) => p.endsWith("pi-subagents-h"))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
