import type { ComposerPanelKind } from "../stores/composerPanelStore";

export type ToolbarItemId = "new-chat" | "commands" | "model" | "tree" | "history" | "files" | "account";

export interface ToolbarItemDef {
  id: ToolbarItemId;
  panel: Exclude<ComposerPanelKind, null> | null;
  enterToActivate: boolean;
}

/** Desktop toolbar — full set. */
export const DESKTOP_TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { id: "commands", panel: "commands", enterToActivate: false },
  { id: "model", panel: "model", enterToActivate: false },
  { id: "tree", panel: "tree", enterToActivate: false },
  { id: "history", panel: "history", enterToActivate: false },
  { id: "files", panel: "files", enterToActivate: false },
  { id: "account", panel: "account", enterToActivate: false },
  { id: "new-chat", panel: null, enterToActivate: true },
];

/** Mobile toolbar — commands, files, history, new chat only. */
export const MOBILE_TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { id: "commands", panel: "commands", enterToActivate: false },
  { id: "files", panel: "files", enterToActivate: false },
  { id: "history", panel: "history", enterToActivate: false },
  { id: "new-chat", panel: null, enterToActivate: true },
];

/** Right-side band the toolbar may occupy — left remainder stays empty. */
export const TOOLBAR_BAND_RATIO = 0.8;

/** Remove-first order when the bar is wider than the 80% band. */
export const TOOLBAR_TRIM_ORDER: ToolbarItemId[] = [
  "model",
  "account",
  "tree",
  "files",
  "history",
  "new-chat",
];

/** Never dropped — commands stays; send lives in the input row below. */
export const TOOLBAR_PROTECTED: ToolbarItemId[] = ["commands"];

export function toolbarBtnWidthPx(rootFontPx?: number): number {
  const fontPx =
    rootFontPx ??
    ((typeof document !== "undefined"
      ? parseFloat(getComputedStyle(document.documentElement).fontSize)
      : 16) || 16);
  // Matches design.css: 22rem bar / 7 desktop slots — button size stays constant.
  return (22 / 7) * fontPx;
}

/** Drop toolbar items one-by-one until the bar fits in `bandWidthPx`. */
export function fitToolbarItemsToBand(
  items: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  if (bandWidthPx <= 0 || btnWidthPx <= 0) return items;
  let kept = [...items];
  while (kept.length * btnWidthPx > bandWidthPx) {
    const drop = TOOLBAR_TRIM_ORDER.find(
      (id) => !TOOLBAR_PROTECTED.includes(id) && kept.some((item) => item.id === id),
    );
    if (!drop) break;
    kept = kept.filter((item) => item.id !== drop);
  }
  const fallback = items.filter((item) => TOOLBAR_PROTECTED.includes(item.id));
  return kept.length > 0 ? kept : fallback.length > 0 ? fallback : items.slice(0, 1);
}

export function toolbarItemsForLayout(isMobile: boolean): ToolbarItemDef[] {
  return isMobile ? MOBILE_TOOLBAR_ITEMS : DESKTOP_TOOLBAR_ITEMS;
}

export function panelToolbarIndex(
  panel: Exclude<ComposerPanelKind, null>,
  items: ToolbarItemDef[],
): number {
  const idx = items.findIndex((item) => item.panel === panel);
  return idx >= 0 ? idx : 0;
}

/** Panels that expand in the center stage stack instead of the composer popup. */
export function isElevatedPanel(panel: ComposerPanelKind | null, _isMobile = false): boolean {
  return panel === "tree";
}
