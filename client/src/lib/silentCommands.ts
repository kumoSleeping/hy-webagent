/** Slash / extension inputs that trigger actions only — never shown in main chat. */
export function isSilentCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}
