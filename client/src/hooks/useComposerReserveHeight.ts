import { useEffect, useState } from "react";

const DEFAULT_RESERVE = 220;
const COMPOSER_SAFE_GAP = 16;

/**
 * Keep the composer and its attached toolbar clear at the bottom so the final
 * message line is never hidden behind either surface.
 */
export function measureComposerReserveHeight(): number {
  const shell = document.querySelector(".pi-interactive-shell");
  if (!shell) return DEFAULT_RESERVE;

  const shellRect = shell.getBoundingClientRect();
  const composer = document.querySelector(".pi-composer-shell");
  const composerTop = composer?.getBoundingClientRect().top ?? shellRect.top;
  const toolbar = document.querySelector(".pi-composer-toolbar-bar");
  const toolbarRect = toolbar?.getBoundingClientRect();
  const clearTop = toolbarRect && toolbarRect.height > 0
    ? Math.min(composerTop, toolbarRect.top)
    : composerTop;
  return Math.ceil(shellRect.bottom - clearTop + COMPOSER_SAFE_GAP);
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
