import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import {
  adjustToolbarItemsForBand,
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

/** Mobile: step toolbar buttons in/out one at a time to fit the right 80% band. */
export function useFittedToolbarItems(
  isMobileLayout: boolean,
  shellRef: RefObject<HTMLElement | null>,
): ToolbarItemDef[] {
  const baseItems = useMemo(() => toolbarItemsForLayout(isMobileLayout), [isMobileLayout]);
  const [items, setItems] = useState<ToolbarItemDef[]>(() => {
    // On mobile, estimate the initial fitted set from the viewport so the first
    // paint does not render the full 7-item pool and overflow off-screen before
    // the ResizeObserver measures the composer shell.
    if (!isMobileLayout) return baseItems;
    const width = typeof window !== "undefined" ? window.innerWidth : 0;
    const bandPx = width * TOOLBAR_BAND_RATIO;
    const btnW = toolbarBtnWidthPx();
    return convergeItemsForBand(baseItems, baseItems, bandPx, btnW);
  });

  // Sync the fitted set when the layout changes (mobile <-> desktop) or when
  // the base item pool changes. The ResizeObserver below handles the actual
  // shell-width measurement, so we only seed a reasonable initial estimate here
  // and avoid clobbering a fitted state with the full 7-item pool.
  useEffect(() => {
    if (!isMobileLayout) {
      setItems(baseItems);
      return;
    }
    const width = typeof window !== "undefined" ? window.innerWidth : 0;
    const bandPx = width * TOOLBAR_BAND_RATIO;
    const btnW = toolbarBtnWidthPx();
    setItems(convergeItemsForBand(baseItems, baseItems, bandPx, btnW));
  }, [baseItems, isMobileLayout]);

  // Measure the composer shell immediately before paint and keep it in sync on
  // resize. This ensures the visible button row never overflows the right band.
  useLayoutEffect(() => {
    if (!isMobileLayout) {
      setItems(baseItems);
      return;
    }

    const shell = shellRef.current;
    if (!shell) return;

    const update = () => {
      const bandPx = shell.clientWidth * TOOLBAR_BAND_RATIO;
      const btnW = toolbarBtnWidthPx();
      setItems((prev) =>
        convergeItemsForBand(prev.length ? prev : baseItems, baseItems, bandPx, btnW),
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [isMobileLayout, shellRef, baseItems]);

  return isMobileLayout ? items : baseItems;
}
