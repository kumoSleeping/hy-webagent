import { useEffect, useCallback } from "react";

/** Approximate monospace char width at 0.72rem widget font inside the composer column. */
const CHAR_PX = 6.5;
const MIN_COLS = 48;
const MAX_COLS = 100;

export function measureWidgetRenderWidth(): number {
  const el = document.querySelector(".pi-interactive-shell");
  if (!el) return 64;
  const px = el.getBoundingClientRect().width;
  return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(px / CHAR_PX)));
}

/** Report composer column width so server-side widget render() uses the right measure. */
export function useComposerLayoutSync(sendLayout: (widgetRenderWidth: number) => void) {
  const report = useCallback(() => {
    sendLayout(measureWidgetRenderWidth());
  }, [sendLayout]);

  useEffect(() => {
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [report]);
}
