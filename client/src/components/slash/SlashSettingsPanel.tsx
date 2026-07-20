import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { PanelActions, PanelBody, PanelButton, PanelListRow } from "../common/panel";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface SlashSettingsPanelProps {
  availableLevels?: string[];
  thinkingLevel?: string;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
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

const STEERING_MODES: Array<{ value: "all" | "one-at-a-time"; label: string; detail: string }> = [
  { value: "all", label: "All at once", detail: "Steering" },
  { value: "one-at-a-time", label: "One at a time", detail: "Steering" },
];

const FOLLOW_UP_MODES: Array<{ value: "all" | "one-at-a-time"; label: string; detail: string }> = [
  { value: "all", label: "All at once", detail: "Follow-up" },
  { value: "one-at-a-time", label: "One at a time", detail: "Follow-up" },
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

  useEffect(() => {
    onModelRefresh?.();
  }, []);

  useEffect(() => {
    if (availableLevels?.length) {
      setLevel((prev) =>
        availableLevels.includes(prev) ? prev : (availableLevels[0] as ThinkingLevel)
      );
    }
  }, [availableLevels]);

  useEffect(() => { setMode(steeringMode); }, [steeringMode]);
  useEffect(() => { setFollowUp(followUpMode); }, [followUpMode]);

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
    <PanelBody
      variant="list"
      loading={!levelsLoaded}
      footer={
        <PanelActions>
          <PanelButton variant="primary" onClick={handleSave}>
            <Check size={12} aria-hidden="true" />
            Apply
          </PanelButton>
        </PanelActions>
      }
    >
      {supportedLevels.map((item, index) => (
        <PanelListRow
          key={item.value}
          leading={String(index + 1).padStart(2, "0")}
          leadingKind="index"
          title={item.label}
          detail="Thinking"
          selected={level === item.value}
          onClick={() => setLevel(item.value)}
        />
      ))}
      {STEERING_MODES.map((item, index) => (
        <PanelListRow
          key={`steer-${item.value}`}
          leading={String(index + 1).padStart(2, "0")}
          leadingKind="index"
          title={item.label}
          detail={item.detail}
          selected={mode === item.value}
          onClick={() => setMode(item.value)}
        />
      ))}
      {FOLLOW_UP_MODES.map((item, index) => (
        <PanelListRow
          key={`follow-${item.value}`}
          leading={String(index + 1).padStart(2, "0")}
          leadingKind="index"
          title={item.label}
          detail={item.detail}
          selected={followUp === item.value}
          onClick={() => setFollowUp(item.value)}
        />
      ))}
    </PanelBody>
  );
}
