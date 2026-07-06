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
  const [items, setItems] = useState<ToolbarItemDef[]>(baseItems);

  useEffect(() => {
    setItems(baseItems);
  }, [baseItems]);

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
