import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  adjustToolbarItemsForBand,
  TOOLBAR_BAND_RATIO,
  toolbarBtnWidthPx,
  toolbarItemsForLayout,
  type ToolbarItemDef,
} from "../lib/composerLayout";

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
    return adjustToolbarItemsForBand(baseItems, baseItems, bandPx, btnW);
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
    setItems(adjustToolbarItemsForBand(baseItems, baseItems, bandPx, btnW));
  }, [baseItems, isMobileLayout]);

  useEffect(() => {
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
        adjustToolbarItemsForBand(prev.length ? prev : baseItems, baseItems, bandPx, btnW),
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [isMobileLayout, shellRef, baseItems]);

  return isMobileLayout ? items : baseItems;
}
