import { resolveToolbarSlash } from "./toolbarSlashCommands";

/** Bare slash id without leading `/` or arguments. */
export function getBareSlashId(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const trimmed = text.slice(1).trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return trimmed;
  return trimmed.slice(0, spaceIdx);
}

export function getBareSlashArgText(text: string): string {
  if (!text.startsWith("/")) return "";
  const trimmed = text.slice(1).trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return "";
  return trimmed.slice(spaceIdx + 1).trim();
}

/** Instant commands parsed in ChatPanel.parseSlashCommand. */
const PARSE_INSTANT_IDS = new Set(["new", "compact", "copy"]);

export interface SlashCommandKindRef {
  kind: string;
}

/** SDK-handled slash inputs — forwarded to session.prompt(), not the web router. */
const SDK_PROMPT_KINDS = new Set(["extension", "prompt", "skill"]);

/** Whether Enter should submit this slash input (not pick from the list). */
export function canSubmitBareSlash(
  value: string,
  findCommand: (id: string) => SlashCommandKindRef | undefined
): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return false;

  const id = getBareSlashId(trimmed);
  if (!id) return false;

  const argText = getBareSlashArgText(trimmed);
  if (argText) return true;

  if (resolveToolbarSlash(trimmed)) return true;

  if (PARSE_INSTANT_IDS.has(id.toLowerCase())) return true;

  const cmd = findCommand(id);
  if (cmd?.kind === "instant") return true;
  if (cmd && SDK_PROMPT_KINDS.has(cmd.kind)) return true;

  // Panel/args commands without arguments open UI instead of sending.
  if (cmd?.kind === "panel" || cmd?.kind === "args") return false;

  // Unknown slash — let the SDK resolve (extension/prompt not yet in registry).
  return true;
}

/** True when Enter should pick from the filtered list instead of submitting the raw text. */
export function shouldPickSlashFromList(
  value: string,
  filtered: ReadonlyArray<{ id: string; label: string }>
): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || filtered.length === 0) return false;
  if (getBareSlashArgText(trimmed)) return false;

  const id = getBareSlashId(trimmed);
  if (!id) return false;

  const lower = id.toLowerCase();
  const exactInFiltered = filtered.some(
    (c) => c.id.toLowerCase() === lower || c.label.toLowerCase() === lower
  );
  return !exactInFiltered;
}
