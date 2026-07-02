import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

/** Replay a conversation branch into a fresh in-memory session (labels skipped). */
export function seedSessionFromBranch(sessionManager: SessionManager, branch: SessionEntry[]): void {
  for (const entry of branch) {
    switch (entry.type) {
      case "message":
        sessionManager.appendMessage(
          entry.message as Parameters<SessionManager["appendMessage"]>[0]
        );
        break;
      case "thinking_level_change":
        sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
        break;
      case "model_change":
        sessionManager.appendModelChange(entry.provider, entry.modelId);
        break;
      case "compaction":
        sessionManager.appendCompaction(
          entry.summary,
          entry.firstKeptEntryId,
          entry.tokensBefore,
          entry.details,
          entry.fromHook
        );
        break;
      case "custom_message":
        sessionManager.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details
        );
        break;
      case "branch_summary":
        sessionManager.branchWithSummary(
          entry.parentId,
          entry.summary,
          entry.details,
          entry.fromHook
        );
        break;
      case "label":
      case "custom":
      case "session_info":
        break;
      default:
        break;
    }
  }
}
