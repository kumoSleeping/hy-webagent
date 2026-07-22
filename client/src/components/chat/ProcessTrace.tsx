import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";
import type { ActivityItem } from "../../lib/assistantTurnState";
import { formatProcessDuration } from "../../lib/messageGrouping";
import type { ToolCallRecord } from "../../types";
import { extractToolTarget, getToolCategory, getToolDisplayLabel, resolveToolOutput } from "../../lib/toolDisplay";
import { CodeBlock } from "./CodeBlock";

interface ProcessTraceProps {
  /** Closed or live run of thinking + tool calls, in arrival order. */
  items: ActivityItem[];
  /** True while this stretch is the agent's current streaming tail. */
  isActive: boolean;
  /** Index of the live step while streaming; null when the run is closed. */
  activeIndex: number | null;
  /** Finished-turn duration from message timestamps (ms); live turns freeze wall-clock. */
  durationMs?: number | null;
  /** Hide thinking segments (preview / hide-thinking mode). */
  hideThinking?: boolean;
}

const DISCLOSURE_ICON_SIZE = 14;

function DisclosureIcon({ expanded }: { expanded: boolean }) {
  return expanded
    ? <ChevronDown size={DISCLOSURE_ICON_SIZE} className="pi-disclosure-icon" />
    : <ChevronRight size={DISCLOSURE_ICON_SIZE} className="pi-disclosure-icon" />;
}

/**
 * Text-style chain for everything before the final answer: thinking and
 * tool calls under one top-level "Working process" toggle.
 *
 * - Fresh history load → collapsed, labeled `Working process · 12s`.
 * - The first answer text closes and collapses a live process immediately.
 * - Click the top label to collapse/expand the whole chain at once.
 * - Click any step to inspect its details.
 */
export const ProcessTrace = memo(function ProcessTrace({
  items,
  isActive,
  activeIndex,
  durationMs = null,
  hideThinking = false,
}: ProcessTraceProps) {
  const visibleItems = hideThinking
    ? items.filter((item): item is Extract<ActivityItem, { kind: "tool" }> => item.kind === "tool")
    : items;

  // Remap activeIndex onto the filtered list when thinking is hidden.
  let visibleActiveIndex: number | null = null;
  if (isActive && activeIndex != null && !hideThinking) {
    visibleActiveIndex = activeIndex;
  } else if (isActive && hideThinking && visibleItems.length > 0) {
    visibleActiveIndex = visibleItems.length - 1;
  }

  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const wasEverActiveRef = useRef(isActive);
  if (isActive) wasEverActiveRef.current = true;

  const previousActiveRef = useRef(isActive);
  const justBecameInactive = previousActiveRef.current && !isActive;
  const expanded = justBecameInactive ? false : manualExpanded ?? wasEverActiveRef.current;
  useEffect(() => {
    if (previousActiveRef.current && !isActive) setManualExpanded(false);
    previousActiveRef.current = isActive;
  }, [isActive]);

  // Prefer wall-clock for the live session (timestamps can be identical when
  // tools share one assistant message); fall back to timestamp span for history.
  const activeSinceRef = useRef<number | null>(null);
  const [frozenMs, setFrozenMs] = useState<number | null>(null);

  useEffect(() => {
    if (isActive) {
      if (activeSinceRef.current == null) activeSinceRef.current = Date.now();
      setFrozenMs(null);
      return;
    }
    if (activeSinceRef.current != null) {
      setFrozenMs(Date.now() - activeSinceRef.current);
    }
  }, [isActive]);

  const displayMs = !isActive ? (frozenMs ?? (durationMs != null && durationMs > 0 ? durationMs : null)) : null;
  const label = isActive
    ? "Working..."
    : displayMs != null
      ? `Working process · ${formatProcessDuration(displayMs)}`
      : "Working process";

  if (visibleItems.length === 0) {
    if (!isActive) return null;
    return (
      <div className="pi-process-trace">
        <div className="pi-process-trace-toggle">
          <Loader2 size={14} className="animate-spin" />
          <span>Working</span>
          <span className="pi-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pi-process-trace">
      <button
        type="button"
        onClick={() => setManualExpanded(!expanded)}
        className="pi-process-trace-toggle"
        aria-expanded={expanded}
      >
        <DisclosureIcon expanded={expanded} />
        <span>{label}</span>
      </button>

      {expanded && (
        <div className="pi-process-trace-steps">
          {visibleItems.map((item, index) => {
            const isLive = visibleActiveIndex === index;
            if (item.kind === "tool") {
              return <ToolStep key={item.tool.toolCallId} toolCall={item.tool} isLive={isLive} />;
            }
            return (
              <ProcessTextStep
                key={`${item.kind}-${index}`}
                text={item.text}
                isLive={isLive}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

const ProcessTextStep = memo(function ProcessTextStep({
  text,
  isLive,
}: {
  text: string;
  isLive: boolean;
}) {
  if (!text) {
    if (!isLive) return null;
    return (
      <div className="pi-process-step">
        <div className="pi-process-step-toggle">
          <Loader2 size={12} className="animate-spin shrink-0" />
          <span>Thinking</span>
          <span className="pi-thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pi-process-step-text pi-process-step-text--thinking">
      {text.trim()}
    </div>
  );
});

const ToolStep = memo(function ToolStep({ toolCall, isLive }: { toolCall: ToolCallRecord; isLive: boolean }) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const { toolName, status, input, output, details, isError } = toolCall;
  const isWeb = getToolCategory(toolName) === "web";
  const wasEverLiveRef = useRef(isLive && !isWeb);
  if (isLive && !isWeb) wasEverLiveRef.current = true;
  const expanded = manualExpanded ?? wasEverLiveRef.current;
  const target = extractToolTarget(toolName, input);
  const label = getToolDisplayLabel(toolName, input);
  const resultText = resolveToolOutput(output, details);
  const errored = isError || status === "error";

  if (isWeb) {
    const preview = target === "web search" || target === "…" ? "" : target;
    return (
      <div className="pi-process-step">
        <div className="pi-process-step-toggle">
          <span className="pi-process-step-label">{label}</span>
          {preview && <span className="pi-process-step-summary">{preview}</span>}
          {status === "running" && <Loader2 size={12} className="animate-spin shrink-0" />}
          {errored && <XCircle size={12} className="text-[var(--pi-theme)] shrink-0" />}
        </div>
      </div>
    );
  }

  return (
    <div className="pi-process-step">
      <button
        type="button"
        onClick={() => setManualExpanded(!expanded)}
        className="pi-process-step-toggle"
        aria-expanded={expanded}
      >
        <DisclosureIcon expanded={expanded} />
        <span className="pi-process-step-label">{label}</span>
        <span className="pi-process-step-summary">{target}</span>
        {status === "running" && <Loader2 size={12} className="animate-spin shrink-0" />}
        {errored && <XCircle size={12} className="text-[var(--pi-theme)] shrink-0" />}
      </button>
      {expanded && (
        <div className="pi-process-step-body pi-process-step-body--tool">
          {input && Object.keys(input).length > 0 && (
            <div>
              <p className="pi-process-step-meta">Input</p>
              <CodeBlock language="json" code={JSON.stringify(input, null, 2)} />
            </div>
          )}
          {resultText ? (
            <div>
              <p className="pi-process-step-meta">Output</p>
              <div className={`pi-process-step-output${errored ? " pi-process-step-output--error" : ""}`}>
                {resultText}
              </div>
            </div>
          ) : status === "running" ? (
            <p className="pi-process-step-meta">Running…</p>
          ) : (
            <p className="pi-process-step-meta">No output returned</p>
          )}
        </div>
      )}
    </div>
  );
});
