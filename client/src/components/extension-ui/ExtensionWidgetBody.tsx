const WIDGET_LABELS: Record<string, string> = {
  goal: "Goal",
  "pi-subagents": "Subagents",
  timer: "Status",
};

export function widgetDisplayLabel(key: string): string {
  return WIDGET_LABELS[key] ?? key;
}

/** Trim blank edges; return empty when all lines are blank. */
export function visibleWidgetLines(lines: string[] | undefined): string[] {
  if (!lines?.length) return [];
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]!.trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

export function hasVisibleWidgets(aboveEditor: Record<string, string[]> | undefined): boolean {
  if (!aboveEditor) return false;
  return Object.keys(aboveEditor).some(
    (key) => visibleWidgetLines(aboveEditor[key]).length > 0
  );
}

export function primaryWidgetLabel(aboveEditor: Record<string, string[]>): string {
  const keys = Object.keys(aboveEditor)
    .filter((key) => visibleWidgetLines(aboveEditor[key]).length > 0)
    .sort();
  if (keys.length === 0) return "Extension";
  if (keys.length === 1) return widgetDisplayLabel(keys[0]!);
  return keys.map(widgetDisplayLabel).join(" · ");
}

interface ExtensionWidgetBodyProps {
  aboveEditor: Record<string, string[]>;
  /** Hide per-block key badge when a single widget fills the stage. */
  compact?: boolean;
}

const NBSP = "\u00A0";

/** Extension widgets in the center stage (pi-goal-x, pi-subagents, …). */
export function ExtensionWidgetBody({ aboveEditor, compact = true }: ExtensionWidgetBodyProps) {
  const widgets = Object.keys(aboveEditor)
    .sort()
    .map((key) => ({ key, lines: visibleWidgetLines(aboveEditor[key]) }))
    .filter((w) => w.lines.length > 0);

  if (widgets.length === 0) {
    return null;
  }

  const showKeys = !(compact && widgets.length === 1);

  return (
    <div className="pi-ext-widget-stack">
      {widgets.map(({ key, lines }) => (
        <div key={key} className="pi-ext-widget-block" aria-label={`Extension ${key}`}>
          {showKeys && <div className="pi-ext-widget-key">{widgetDisplayLabel(key)}</div>}
          {lines.map((line, i) => (
            <div key={i} className="pi-ext-widget-line">
              {line.length > 0 ? line : NBSP}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
