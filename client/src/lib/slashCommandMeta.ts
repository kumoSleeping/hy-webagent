import type { SlashCommand, SlashCommandKind } from "../stores/slashStore";

/** Human-readable origin tag shown beside each slash command. */
export function commandKindLabel(kind: SlashCommandKind): string {
  return kind;
}

/** Whether a command comes from the platform (system) vs loaded resources. */
export function isSystemSlashCommand(cmd: SlashCommand, systemCommands: SlashCommand[]): boolean {
  return systemCommands.some((c) => c.id === cmd.id);
}

/** Short category for grouping: native platform vs prompt/skill/extension. */
export function commandOriginLabel(cmd: SlashCommand, systemCommands: SlashCommand[]): string {
  if (isSystemSlashCommand(cmd, systemCommands)) return "native";
  if (cmd.kind === "prompt") return "prompt";
  if (cmd.kind === "skill") return "skill";
  if (cmd.kind === "extension") return "extension";
  return cmd.kind;
}
