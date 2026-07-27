import { useStatusBarStore } from "../../stores/statusBarStore";

/** Drop blank lines at the top/bottom of a widget; returns [] when all blank. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]!.trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

/** Extension widgets above the composer (e.g. pi-goal-x goal panel). */
export function ExtensionWidgetPanel() {
  const aboveEditor = useStatusBarStore((s) => s.widgets.aboveEditor ?? {});

  // Only render widgets that carry visible content. A widget rendering an
  // empty/whitespace-only frame must not surface as an empty ghost card.
  const widgets = Object.keys(aboveEditor)
    .sort()
    .map((key) => ({ key, lines: trimBlankEdges(aboveEditor[key] ?? []) }))
    .filter((widget) => widget.lines.length > 0);

  if (widgets.length === 0) return null;

  return (
    <div className="pi-extension-widgets">
      {widgets.map(({ key, lines }) => (
        <div key={key} className="pi-extension-widget" aria-label={`Extension widget ${key}`}>
          {lines.map((line, i) => (
            <div key={i} className="pi-extension-widget-line">
              {line.length > 0 ? line : "\u00A0"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 底栏三行(widget/pwd/stats)已按产品决定不再展示。 */
export function StatusBar() {
  return null;
}
