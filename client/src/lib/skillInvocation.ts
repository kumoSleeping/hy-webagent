export interface SkillInvocation {
  name: string;
  userMessage?: string;
}

const SKILL_BLOCK_PATTERN = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;

/** Collapse Pi's model-facing skill expansion back to its user-facing form. */
export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = text.match(SKILL_BLOCK_PATTERN);
  if (!match) return null;
  return {
    name: match[1]!,
    userMessage: match[2]?.trim() || undefined,
  };
}
