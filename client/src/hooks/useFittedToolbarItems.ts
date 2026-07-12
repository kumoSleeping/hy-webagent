import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import {
  adjustToolbarItemsForBand,
  getRootFontPx,
  MOBILE_TOOLBAR_BTN_MAX_PX,
  TOOLBAR_BAND_RATIO,
  toolbarBtnWidthPx,
  toolbarItemsForLayout,
  type ToolbarItemDef,
} from "../lib/composerLayout";

/** Repeatedly apply one-at-a-time trimming/restoring until the set stops changing. */
function convergeItemsForBand(
  current: ToolbarItemDef[],
  base: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  let prev = current;
  let next = adjustToolbarItemsForBand(prev, base, bandWidthPx, btnWidthPx);
  let safety = 0;
  while (next.length !== prev.length && safety < 20) {
    prev = next;
    next = adjustToolbarItemsForBand(prev, base, bandWidthPx, btnWidthPx);
    safety++;
  }
  return next;
}

/** Estimate the composer shell's available 80% band from the viewport.
 *  Mirrors design.css: .pi-interactive-shell padding is
 *  min(1.5rem, clamp(1rem, 2.8vw, 3rem)), and the shell fills the rest. */
function computeBandPx(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.innerWidth;
  if (viewport <= 0) return 0;

  const rootFontPx = getRootFontPx();
  const clamped = Math.max(rootFontPx, Math.min(3 * rootFontPx, viewport * 0.028));
  const shellPadding = Math.min(1.5 * rootFontPx, clamped);
  const shellWidth = viewport - 2 * shellPadding;
  return Math.max(0, shellWidth * TOOLBAR_BAND_RATIO);
}

/** Effective mobile button width, capped so large accessibility font sizes
 *  do not collapse the toolbar to one or two buttons. */
function mobileBtnWidthPx(): number {
  return Math.min(toolbarBtnWidthPx(), MOBILE_TOOLBAR_BTN_MAX_PX);
}

/** Mobile: step toolbar buttons in/out one at a time to fit the right 80% band. */
export function useFittedToolbarItems(
  isMobileLayout: boolean,
  shellRef: RefObject<HTMLElement | null>,
  itemOverride?: ToolbarItemDef[],
): ToolbarItemDef[] {
  const baseItems = useMemo(
    () => itemOverride ?? toolbarItemsForLayout(isMobileLayout),
    [isMobileLayout, itemOverride],
  );

  // On mobile, estimate the initial fitted set from the viewport so the first
  // paint does not render the full 7-item pool and overflow off-screen before
  // the shell measurement is available.
  const [items, setItems] = useState<ToolbarItemDef[]>(() => {
    if (!isMobileLayout) return baseItems;
    return convergeItemsForBand(baseItems, baseItems, computeBandPx(), mobileBtnWidthPx());
  });

  // Sync the fitted set when the layout changes (mobile <-> desktop) or when
  // the base item pool changes. Avoid clobbering a fitted state with the full
  // 7-item pool.
  useLayoutEffect(() => {
    if (!isMobileLayout) {
      setItems(baseItems);
      return;
    }
    setItems(convergeItemsForBand(baseItems, baseItems, computeBandPx(), mobileBtnWidthPx()));
  }, [baseItems, isMobileLayout]);

  // Measure the composer shell immediately before paint and keep it in sync on
  // resize. The shell measurement is the source of truth, but if it reports a
  // suspiciously small width (e.g. before CSS is fully laid out), fall back to
  // the viewport estimate so the toolbar never collapses to just commands.
  useLayoutEffect(() => {
    if (!isMobileLayout) {
      setItems(baseItems);
      return;
    }

    const shell = shellRef.current;
    if (!shell) return;

    const update = () => {
      const measured = shell.clientWidth;
      const estimated = computeBandPx();
      // Use the shell measurement if it looks reasonable; otherwise trust the
      // viewport estimate. A measured width that is less than half the estimate
      // means the shell is probably not fully laid out yet.
      const measuredBand = measured * TOOLBAR_BAND_RATIO;
      const bandPx = measured > 0 && measuredBand > estimated * 0.5 ? measuredBand : estimated;
      setItems((prev) =>
        convergeItemsForBand(prev.length ? prev : baseItems, baseItems, bandPx, mobileBtnWidthPx()),
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [isMobileLayout, shellRef, baseItems]);

  return isMobileLayout ? items : baseItems;
}
