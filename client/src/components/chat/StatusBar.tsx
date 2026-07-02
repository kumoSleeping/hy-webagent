import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../../stores/sessionStore";
import { useStatusBarStore, splitWidgetLine } from "../../stores/statusBarStore";

const NBSP = "\u00A0";

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
              {line.length > 0 ? line : NBSP}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Native pi footer + below-editor widgets — fixed row slots prevent composer jump. */
export function StatusBar() {
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  const footer = useStatusBarStore((s) => s.footer);
  const belowEditor = useStatusBarStore(useShallow((s) => s.widgets.belowEditor ?? {}));

  const widgetRow = useMemo(() => {
    for (const key of Object.keys(belowEditor).sort()) {
      const line = belowEditor[key]?.[0];
      if (line) return splitWidgetLine(line);
    }
    return null;
  }, [belowEditor]);

  if (!activePiSessionId) return null;

  return (
    <div className="pi-status-bar-stack" aria-live="polite">
      <div className={`pi-status-bar pi-status-bar--widget${widgetRow ? "" : " pi-status-bar--slot-empty"}`}>
        {widgetRow ? (
          <>
            <span className="pi-status-bar-item">{widgetRow.left}</span>
            {widgetRow.right && (
              <span className="pi-status-bar-item pi-status-bar-item--right">{widgetRow.right}</span>
            )}
          </>
        ) : (
          <span className="pi-status-bar-item" aria-hidden="true">{NBSP}</span>
        )}
      </div>

      <div className={`pi-status-bar pi-status-bar--pwd${footer?.pwdLine ? "" : " pi-status-bar--slot-empty"}`}>
        <span className="pi-status-bar-item">{footer?.pwdLine || NBSP}</span>
      </div>

      <div className={`pi-status-bar pi-status-bar--stats${footer?.statsLeft || footer?.modelRight ? "" : " pi-status-bar--slot-empty"}`}>
        <span className="pi-status-bar-item">{footer?.statsLeft || NBSP}</span>
        <span className="pi-status-bar-item pi-status-bar-item--right">{footer?.modelRight || NBSP}</span>
      </div>

      <div className={`pi-status-bar pi-status-bar--extensions${footer?.extensionLine ? "" : " pi-status-bar--slot-empty"}`}>
        <span className="pi-status-bar-item">{footer?.extensionLine || NBSP}</span>
      </div>
    </div>
  );
}
