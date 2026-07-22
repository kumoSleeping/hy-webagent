import { memo, useState } from "react";
import { ChevronDown, ChevronRight, XCircle, Loader2 } from "lucide-react";
import type { ToolCallRecord } from "../../types";
import { CodeBlock } from "./CodeBlock";
import { extractToolTarget, resolveToolOutput } from "../../lib/toolDisplay";

interface ToolCallCardProps {
  toolCall: ToolCallRecord;
}

export const ToolCallCard = memo(function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { toolName, status, input, output, details, isError } = toolCall;

  const statusIcon = {
    running: <Loader2 size={14} className="animate-spin text-[var(--pi-theme)]" />,
    done: null,
    error: <XCircle size={14} className="text-[var(--pi-theme)]" />,
    pending: null,
  };

  const target = extractToolTarget(toolName, input);
  const resultText = resolveToolOutput(output, details);

  return (
    <div className="pi-tool-feature pi-tool-call">
      <div className="pi-corner-badge">
        {status === "error" && <XCircle size={10} />}
        <span>{toolName}</span>
      </div>

      <div className="pi-tool-feature-body">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2.5 px-4 pt-8 pb-2.5 text-left text-sm hover:bg-white transition-colors cursor-pointer"
        >
          <span className="min-w-0 flex-1 text-[var(--pi-text-body)] leading-snug truncate font-mono">
            {target}
          </span>
          <span className="shrink-0">{statusIcon[status]}</span>
          {expanded ? (
            <ChevronDown size={14} className="text-[var(--pi-muted)] shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-[var(--pi-muted)] shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="border-t border-[var(--pi-line)] px-4 py-3 space-y-3 bg-white">
            {input && Object.keys(input).length > 0 && (
              <div>
                <p className="text-[var(--pi-muted)] mb-1.5 font-bold uppercase tracking-wider text-[0.72rem]">Input</p>
                <CodeBlock language="json" code={JSON.stringify(input, null, 2)} />
              </div>
            )}
            {resultText ? (
              <div>
                <p className="text-[var(--pi-muted)] mb-1.5 font-bold uppercase tracking-wider text-[0.72rem]">Output</p>
                <div
                  className={`whitespace-pre-wrap font-mono text-[0.8125rem] leading-relaxed ${
                    isError ? "text-[#dc2626]" : "text-[var(--pi-text-body)]"
                  } max-h-60 overflow-auto pi-scrollbar`}
                >
                  {resultText}
                </div>
              </div>
            ) : status === "running" ? (
              <p className="text-[var(--pi-muted)] font-mono">Running…</p>
            ) : (
              <p className="text-[var(--pi-muted)] font-mono">No output returned</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
