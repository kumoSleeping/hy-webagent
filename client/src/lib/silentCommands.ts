/** Slash / extension inputs that trigger actions only — never shown in main chat. */
export function isSilentCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

export function parseBtwQuestion(text: string): string | null {
  const m = text.trim().match(/^\/btw(?:\s+(.+))?$/i);
  const q = m?.[1]?.trim();
  return q || null;
}
