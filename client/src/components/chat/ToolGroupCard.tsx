import { memo } from "react";
import type { ActivityItem } from "../../lib/blockGrouping";
import type { ToolCategory } from "../../lib/toolDisplay";
import { ProcessTrace } from "./ProcessTrace";

interface ToolGroupCardProps {
  /** A run of thinking + tool calls interleaved, in arrival order. */
  items: ActivityItem[];
  toolCount: number;
  category: ToolCategory | null;
  isActive?: boolean;
  activeIndex?: number | null;
  hideThinking?: boolean;
}

/**
 * Compatibility wrapper — activity stretches now render as a text-style
 * "Working process" chain (see ProcessTrace) instead of red feature cards.
 */
export const ToolGroupCard = memo(function ToolGroupCard({
  items,
  isActive = false,
  activeIndex = null,
  hideThinking = false,
}: ToolGroupCardProps) {
  return (
    <ProcessTrace
      items={items}
      isActive={isActive}
      activeIndex={activeIndex}
      hideThinking={hideThinking}
    />
  );
});
