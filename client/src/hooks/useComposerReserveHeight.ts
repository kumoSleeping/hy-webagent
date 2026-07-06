import { useEffect, useState } from "react";

const FADE_VAR = "--pi-composer-fade";
const DEFAULT_RESERVE = 280;

/** Resolve a root CSS length (e.g. `2rem`) to pixels — parseFloat alone turns `2rem` into `2`. */
export function readRootCssLengthPx(varName: string, fallbackPx: number): number {
  if (typeof document === "undefined") return fallbackPx;

  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(varName).trim();
  if (!raw) return fallbackPx;

  const match = raw.match(/^([\d.]+)(rem|px|em)$/);
  if (!match) return fallbackPx;

  const value = parseFloat(match[1]!);
  const unit = match[2]!;
  if (unit === "px") return value;

  const rootFontPx = parseFloat(getComputedStyle(root).fontSize) || 16;
  return value * rootFontPx;
}

/**
 * Vertical band the message feed must keep clear: toolbar/badges → status bar,
 * plus the dissolve band above the composer (--pi-composer-fade). That band is
 * only background when pinned to the bottom — message text must end above it so
 * the last line stays fully readable after auto-scroll. Uses bounding boxes
 * because the toolbar is absolutely positioned and ResizeObserver contentRect
 * alone under-counts the overlay footprint.
 */
export function measureComposerReserveHeight(): number {
  const shell = document.querySelector(".pi-interactive-shell");
  if (!shell) return DEFAULT_RESERVE;

  const shellRect = shell.getBoundingClientRect();
  let top = shellRect.top;

  for (const sel of [".pi-composer-toolbar-bar", ".pi-composer-badges", ".pi-status-bar-stack"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const { top: elTop, height } = el.getBoundingClientRect();
    if (height > 0) top = Math.min(top, elTop);
  }

  return Math.ceil(shellRect.bottom - top + readRootCssLengthPx(FADE_VAR, 32));
}

/** Track live composer overlay height for message-feed paddingBottom. */
export function useComposerReserveHeight(deps: readonly unknown[] = []) {
  const [reserve, setReserve] = useState(DEFAULT_RESERVE);

  useEffect(() => {
    const measure = () => setReserve(measureComposerReserveHeight());
    measure();

    const shell = document.querySelector(".pi-interactive-shell");
    if (!shell) return;

    const ro = new ResizeObserver(measure);
    ro.observe(shell);

    for (const sel of [".pi-composer-toolbar-bar", ".pi-status-bar-stack"]) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }

    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes reactive deps intentionally
  }, deps);

  return reserve;
}
