import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  fitToolbarItemsToBand,
  TOOLBAR_BAND_RATIO,
  toolbarBtnWidthPx,
  toolbarItemsForLayout,
  type ToolbarItemDef,
} from "../lib/composerLayout";

/** Mobile/narrow: trim toolbar buttons until the bar fits in the right 80% band. */
export function useFittedToolbarItems(
  isMobileLayout: boolean,
  shellRef: RefObject<HTMLElement | null>,
): ToolbarItemDef[] {
  const baseItems = useMemo(() => toolbarItemsForLayout(isMobileLayout), [isMobileLayout]);
  const [items, setItems] = useState<ToolbarItemDef[]>(baseItems);

  useEffect(() => {
    setItems(baseItems);
    if (!isMobileLayout) return;

    const shell = shellRef.current;
    if (!shell) return;

    const update = () => {
      const bandPx = shell.clientWidth * TOOLBAR_BAND_RATIO;
      setItems(fitToolbarItemsToBand(baseItems, bandPx, toolbarBtnWidthPx()));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [isMobileLayout, shellRef, baseItems]);

  return isMobileLayout ? items : baseItems;
}
