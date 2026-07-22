import { useEffect, useState } from "react";

const DEFAULT_RESERVE = 220;

/**
 * Keep only the actual composer body clear. The toolbar and short dissolve band
 * intentionally overlap the feed so messages fade out at the input's top edge
 * instead of leaving a large empty strip above it.
 */
export function measureComposerReserveHeight(): number {
  const shell = document.querySelector(".pi-interactive-shell");
  if (!shell) return DEFAULT_RESERVE;

  const shellRect = shell.getBoundingClientRect();
  const composer = document.querySelector(".pi-composer-shell");
  const composerTop = composer?.getBoundingClientRect().top ?? shellRect.top;
  return Math.ceil(shellRect.bottom - composerTop);
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
