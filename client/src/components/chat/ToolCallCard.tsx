import { memo } from "react";
import type { ToolCallRecord } from "../../types";
import { ProcessTrace } from "./ProcessTrace";

interface ToolCallCardProps {
  toolCall: ToolCallRecord;
  /** True while this lone tool is the live streaming step. */
  isActive?: boolean;
}

/**
 * Single tool call as a text-style Working process step.
 * Kept as a thin wrapper for legacy messages that only have `toolCalls`.
 */
export const ToolCallCard = memo(function ToolCallCard({ toolCall, isActive = false }: ToolCallCardProps) {
  return (
    <ProcessTrace
      items={[{ kind: "tool", tool: toolCall }]}
      isActive={isActive}
      activeIndex={isActive ? 0 : null}
    />
  );
});
