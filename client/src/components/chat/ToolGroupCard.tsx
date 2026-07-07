import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Globe, Layers, Wrench, XCircle } from "lucide-react";
import type { ActivityItem } from "../../lib/blockGrouping";
import type { ToolCallRecord } from "../../types";
import type { ToolCategory } from "../../lib/toolDisplay";
import { extractToolTarget } from "../../lib/toolDisplay";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

interface ToolGroupCardProps {
  /** A closed run of 2+ items (thinking + tool calls interleaved, in arrival order). */
  items: ActivityItem[];
  toolCount: number;
  category: ToolCategory | null;
}

/**
 * Collapsed summary for a finished stretch of agent activity (thinking and
 * tool calls, however they were interleaved). While the agent is actively
 * working, everything shows as it happens (see ThinkingBlock/ToolCallCard);
 * once it moves on to an actual answer, that whole stretch collapses down
 * into this single expandable block so it doesn't dominate the transcript.
 * Expanding it reveals the exact same individual pieces, in the same order.
 */
export const ToolGroupCard = memo(function ToolGroupCard({ items, toolCount, category }: ToolGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const tools = items.filter((i): i is { kind: "tool"; tool: ToolCallRecord } => i.kind === "tool").map((i) => i.tool);
  const hasError = tools.some((t) => t.isError || t.status === "error");

  const badgeLabel =
    category === "web" ? `${toolCount} Web` : category === "tools" ? `${toolCount} Tools` : `${toolCount || items.length} Steps`;
  const BadgeIcon = category === "web" ? Globe : category === "tools" ? Wrench : Layers;

  const targets = tools.map((t) => extractToolTarget(t.toolName, t.input));
  const summary =
    targets.length > 0
      ? targets.slice(0, 3).join(" · ") + (targets.length > 3 ? ` +${targets.length - 3}` : "")
      : items.find((i) => i.kind === "thinking")?.text.slice(0, 120) || "…";

  return (
    <div className="pi-tool-group relative border border-[var(--pi-line)] bg-[var(--pi-panel-subtle)] overflow-visible">
      <div className="pi-corner-badge">
        {hasError ? <XCircle size={10} /> : <BadgeIcon size={10} />}
        <span>{badgeLabel}</span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-4 pt-8 pb-2.5 text-left text-sm hover:bg-white transition-colors cursor-pointer"
      >
        <span className="min-w-0 flex-1 text-[var(--pi-text-body)] leading-snug truncate font-mono">
          {summary}
        </span>
        {hasError && <XCircle size={14} className="text-[var(--pi-theme)] shrink-0" />}
        {expanded ? (
          <ChevronDown size={14} className="text-[var(--pi-muted)] shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-[var(--pi-muted)] shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="pi-tool-group-body border-t border-[var(--pi-line)] px-4 py-3 space-y-2.5 bg-white">
          {items.map((item, i) =>
            item.kind === "tool" ? (
              <ToolCallCard key={item.tool.toolCallId} toolCall={item.tool} />
            ) : (
              <ThinkingBlock key={`think-${i}`} content={item.text} isActive={false} />
            )
          )}
        </div>
      )}
    </div>
  );
});
