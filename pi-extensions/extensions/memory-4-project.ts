/**
 * memory-4-project — A persistent project memory system via Memories.md
 *
 * Enhanced /dream: reads current session + all past sessions from disk,
 * then synthesizes everything into Memories.md.
 *
 * - Current session: read from live ctx.sessionManager (model already has context)
 * - Past sessions: read from ~/.pi/agent/sessions/--<project>--/*.jsonl
 * - Extracts first user message + timestamp from each past session
 */

import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ── Session directory helpers ──

function getSessionDir(cwd: string): string {
	const safe = cwd === "/" ? "" : cwd.replace(/^\//, "").replace(/\//g, "--");
	return join(homedir(), ".pi", "agent", "sessions", `--${safe}--`);
}

interface SessionMeta {
	timestamp: string;
	firstUserMessage: string;
	messageCount: number;
}

/**
 * Read a session .jsonl file and extract just the metadata:
 * timestamp, first user message, and total message count.
 * Skips tool results and thinking blocks to keep it light.
 */
async function extractSessionMeta(filePath: string): Promise<SessionMeta | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n");
		if (lines.length === 0) return null;

		const header = JSON.parse(lines[0]);
		if (header.type !== "session") return null;

		const timestamp = header.timestamp || "";
		let firstUserMsg = "";
		let msgCount = 0;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message") {
					msgCount++;
					if (!firstUserMsg && entry.message?.role === "user") {
						const content = entry.message.content;
						if (Array.isArray(content)) {
							for (const c of content) {
								if (c.type === "text" && c.text) {
									firstUserMsg = c.text.trim();
									break;
								}
							}
						}
					}
				}
			} catch {
				continue;
			}
		}

		return {
			timestamp,
			firstUserMessage: firstUserMsg || "(empty session)",
			messageCount: msgCount,
		};
	} catch {
		return null;
	}
}

/**
 * Scan all past session files for this project, extract metadata,
 * and return a compact Markdown summary.
 * Excludes the currently-open session file (if known).
 */
async function getPastSessionSummaries(
	cwd: string,
	currentSessionFile?: string | null,
): Promise<string> {
	const dir = getSessionDir(cwd);
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return "";
	}

	const jsonlFiles = files
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => join(dir, f))
		.filter((f) => f !== (currentSessionFile ?? ""))
		.sort((a, b) => b.localeCompare(a)) // newest first
		.slice(0, 60); // cap for performance

	if (jsonlFiles.length === 0) return "";

	// Read all files in parallel
	const metas = (await Promise.all(jsonlFiles.map((f) => extractSessionMeta(f)))).filter(
		(m): m is SessionMeta => m !== null,
	);

	if (metas.length === 0) return "";

	// Build a compact Markdown list: date + first user message
	const lines: string[] = [];
	for (const m of metas) {
		const date = m.timestamp.slice(0, 10); // "2026-07-01"
		const preview =
			m.firstUserMessage.length > 200
				? m.firstUserMessage.slice(0, 200) + "..."
				: m.firstUserMessage;
		lines.push(`- **${date}** (${m.messageCount} msgs): ${preview}`);
	}

	return lines.join("\n");
}

/**
 * Extract a brief summary of the current (live) session from the branch.
 * The model already has full context — this is just for reference.
 */
function getCurrentSessionHighlights(branch: SessionEntry[]): string {
	const userMsgs: string[] = [];

	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const msg = (entry as SessionEntry & { type: "message" }).message;
		if (msg.role !== "user") continue;

		const content = msg.content;
		if (!Array.isArray(content)) continue;

		for (const c of content) {
			if (c.type === "text" && c.text) {
				const trimmed = c.text.trim();
				if (trimmed) {
					userMsgs.push(trimmed.length > 250 ? trimmed.slice(0, 250) + "..." : trimmed);
				}
				break;
			}
		}
	}

	if (userMsgs.length === 0) return "(no user messages yet)";

	return userMsgs.map((m, i) => `${i + 1}. ${m}`).join("\n");
}

// ── Extension ──

export default function (pi: ExtensionAPI) {
	// ── Inject memory system context into the system prompt ──
	pi.on("before_agent_start", async (event, ctx) => {
		const memoryPath = join(ctx.cwd, "Memories.md");

		return {
			systemPrompt:
				event.systemPrompt +
				[
					"",
					"## 🧠 Workspace Memory System",
					"",
					"This workspace maintains a **Memories.md** file as a persistent knowledge base across sessions.",
					"",
					`**Location:** \`${memoryPath}\``,
					"",
					"**Your responsibilities:**",
					"- At the start of a session, **read** `Memories.md` to recall workspace context.",
					"- **Update it** whenever you discover something worth remembering: architectural decisions, key findings, design patterns, configuration details, known issues, or anything else that matters for this workspace's future.",
					"- **Organize** memories under clear headings using categories that make sense (e.g., Architecture, Decisions, Known Issues, Patterns, Configurations, Next Steps).",
					"- **Restructure autonomously** when the file grows large — split into sections, create sub-files, or reorganize however you see fit.",
					"- **Use your judgment** to decide what's worth remembering, at what level of detail, and how to structure it.",
					"- **After updating Memories.md**, always summarize what you changed — what was added, revised, or reorganized.",
					"",
					"Use the built-in `read`, `edit`, and `write` tools to manage this file. Treat it as a living document.",
					"",
					"> Tip: Use `/dream` to synthesize memories from the current session AND all past sessions for this workspace. The command reads your full conversation history from disk to produce comprehensive, cross-session memory updates.",
				].join("\n"),
		};
	});

	// ── /dream command: reads all sessions, synthesizes into Memories.md ──
	pi.registerCommand("dream", {
		description:
			"Synthesize current + past sessions into Memories.md — reads full conversation history",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Waiting for agent to finish...", "info");
				await ctx.waitForIdle();
			}

			const memoryPath = join(ctx.cwd, "Memories.md");

			// Read existing memories
			let existingMemories = "";
			try {
				existingMemories = await readFile(memoryPath, "utf-8");
			} catch {
				// No existing memories yet — that's fine
			}

			// ── Current session highlights ──
			const branch = ctx.sessionManager.getBranch() as SessionEntry[];
			const currentHighlights = getCurrentSessionHighlights(branch);

			// ── Past session summaries from disk ──
			ctx.ui.notify("📖 Reading past sessions...", "info");
			const currentFile = ctx.sessionManager.getSessionFile();
			const pastSessions = await getPastSessionSummaries(ctx.cwd, currentFile);

			// ── Build the dream prompt ──
			const parts: string[] = [
				"/dream: Please synthesize our conversation history into Memories.md.",
				"",
				"## Current Session Highlights",
				"You already have the full conversation in context. Here are the key user messages for reference:",
				"",
				currentHighlights,
			];

			if (pastSessions) {
				parts.push(
					"",
					"## Past Sessions (for this workspace)",
					"Each entry shows the date, message count, and the first user message of that session:",
					"",
					pastSessions,
				);
			}

			if (existingMemories.trim()) {
				parts.push(
					"",
					"## Existing Memories",
					"",
					"```markdown",
					existingMemories.trim(),
					"```",
				);
			}

			parts.push(
				"",
				"## Instructions",
				"",
				"1. Synthesize insights from the **current session** (you have the full context) AND all **past sessions** (listed above)",
				"2. Add new discoveries, decisions, patterns, and knowledge to Memories.md",
				"3. Revise anything that is outdated, incorrect, or no longer relevant",
				"4. Reorganize for clarity if the file has grown large — create sections, sub-files, whatever helps",
				"5. Be concise — only capture what truly matters for this workspace's future",
				"6. Use clear category headings (e.g., Architecture, Decisions, Known Issues, Patterns, Configurations, Active Projects, Next Steps)",
				"",
				"When you're done, tell me concisely what you added, revised, or reorganized, and why.",
			);

			ctx.ui.notify("💭 Dreaming across all sessions...", "info");
			pi.sendUserMessage(parts.join("\n"));
		},
	});
}
