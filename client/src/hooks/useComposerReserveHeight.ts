import { useEffect, useState } from "react";

const RESERVE_VAR = "--pi-composer-fade";
const DEFAULT_RESERVE = 280;

function readFadePx(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(RESERVE_VAR).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 80;
}

/**
 * Vertical band the message feed must keep clear: toolbar/badges → status bar,
 * plus the soft fade above (--pi-composer-fade). Uses bounding boxes because
 * the toolbar is absolutely positioned and ResizeObserver contentRect alone
 * under-counts the overlay footprint.
 */
export function measureComposerReserveHeight(): number {
  const shell = document.querySelector(".pi-interactive-shell");
  if (!shell) return DEFAULT_RESERVE;

  const shellRect = shell.getBoundingClientRect();
  let top = shellRect.top;

  for (const sel of [".pi-composer-toolbar", ".pi-composer-badges", ".pi-composer-files-overlay"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const { top: elTop, height } = el.getBoundingClientRect();
    if (height > 0) top = Math.min(top, elTop);
  }

  return Math.ceil(shellRect.bottom - top + readFadePx());
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

    const toolbar = document.querySelector(".pi-composer-toolbar");
    if (toolbar) ro.observe(toolbar);

    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes reactive deps intentionally
  }, deps);

  return reserve;
}
