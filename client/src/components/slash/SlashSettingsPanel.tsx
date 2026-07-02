import { useState, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface SlashSettingsPanelProps {
  /** Which thinking levels the current model actually supports */
  availableLevels?: string[];
  /** Current thinking level */
  thinkingLevel?: string;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
  /** Called on mount to refresh model-specific data */
  onModelRefresh?: () => void;
}

const ALL_THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
];

const STEERING_MODES: Array<{ value: "all" | "one-at-a-time"; label: string }> = [
  { value: "all", label: "All at once" },
  { value: "one-at-a-time", label: "One at a time" },
];

export function SlashSettingsPanel({
  availableLevels,
  thinkingLevel = "medium",
  steeringMode = "all",
  followUpMode = "all",
  onExecute,
  onClose,
  onModelRefresh,
}: SlashSettingsPanelProps) {
  const [level, setLevel] = useState<ThinkingLevel>(
    (availableLevels?.length && availableLevels.includes(thinkingLevel)
      ? thinkingLevel
      : availableLevels?.[0]) as ThinkingLevel ?? "medium"
  );
  const [mode, setMode] = useState<"all" | "one-at-a-time">(steeringMode);
  const [followUp, setFollowUp] = useState<"all" | "one-at-a-time">(followUpMode);

  // Refresh model data when panel opens, so thinking levels are current
  useEffect(() => {
    onModelRefresh?.();
  }, []);

  // Sync state when props update (e.g. after refresh)
  useEffect(() => {
    if (availableLevels?.length) {
      setLevel((prev) =>
        availableLevels.includes(prev) ? prev : (availableLevels[0] as ThinkingLevel)
      );
    }
  }, [availableLevels]);

  useEffect(() => { setMode(steeringMode); }, [steeringMode]);
  useEffect(() => { setFollowUp(followUpMode); }, [followUpMode]);

  // Filter to only levels the model supports
  const supportedLevels = availableLevels?.length
    ? ALL_THINKING_LEVELS.filter((l) => availableLevels.includes(l.value))
    : [];

  const levelsLoaded = availableLevels !== undefined && availableLevels.length > 0;

  function handleSave() {
    onExecute("settings.set", { key: "thinkingLevel", value: level });
    onExecute("settings.set", { key: "steeringMode", value: mode });
    onExecute("settings.set", { key: "followUpMode", value: followUp });
    onClose();
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto pi-scrollbar p-3 space-y-4">
        <div>
          {!levelsLoaded ? (
            <div className="flex items-center justify-center py-4 text-[var(--pi-muted)]">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : supportedLevels.length > 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {supportedLevels.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setLevel(item.value)}
                  className={`h-8 text-[0.72rem] uppercase tracking-wider border transition-colors cursor-pointer outline-none ${
                    level === item.value
                      ? "border-[var(--pi-theme)] bg-[var(--pi-accent-soft)] text-[var(--pi-text)]"
                      : "border-[var(--pi-line)] bg-white text-[var(--pi-text)] hover:border-[var(--pi-theme)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "all" | "one-at-a-time")}
            className="w-full h-9 border border-[var(--pi-line)] bg-white px-2.5 text-[0.8125rem] text-[var(--pi-text)] outline-none focus:border-[var(--pi-theme)] cursor-pointer"
          >
            {STEERING_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value as "all" | "one-at-a-time")}
            className="w-full h-9 border border-[var(--pi-line)] bg-white px-2.5 text-[0.8125rem] text-[var(--pi-text)] outline-none focus:border-[var(--pi-theme)] cursor-pointer"
          >
            {STEERING_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="shrink-0 flex justify-end p-2.5">
        <button
          type="button"
          onClick={handleSave}
          className="flex h-8 items-center gap-1.5 bg-[var(--pi-text)] px-3 text-[0.72rem] uppercase tracking-wider text-white transition-all hover:bg-[#1c1c1e] cursor-pointer"
        >
          <Check size={12} />
          Apply
        </button>
      </div>
    </div>
  );
}
