import type { ComposerPanelKind } from "../stores/composerPanelStore";

export type ToolbarItemId =
  | "new-chat"
  | "open-window"
  | "commands"
  | "model"
  | "tree"
  | "history"
  | "files"
  | "account"
  | "return-chat";

export interface ToolbarItemDef {
  id: ToolbarItemId;
  panel: Exclude<ComposerPanelKind, null> | null;
  enterToActivate: boolean;
}

/** Desktop toolbar — full set.(open-window = 小窗模式的显式入口:
 *  把当前会话弹成直播小窗 —— 否则零窗时只剩 ⌘/Ctrl 点历史行这个隐藏入口。) */
export const DESKTOP_TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { id: "commands", panel: "commands", enterToActivate: false },
  { id: "model", panel: "model", enterToActivate: false },
  { id: "tree", panel: "tree", enterToActivate: false },
  { id: "history", panel: "history", enterToActivate: false },
  { id: "files", panel: "files", enterToActivate: false },
  { id: "account", panel: "account", enterToActivate: false },
  { id: "open-window", panel: null, enterToActivate: true },
  { id: "new-chat", panel: null, enterToActivate: true },
];

/** Mobile toolbar — same pool as desktop; trimmed one item at a time
 *  in the order tree → open-window → account → model → files → history,
 *  always keeping commands + new-chat. */
export const MOBILE_TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { id: "commands", panel: "commands", enterToActivate: false },
  { id: "model", panel: "model", enterToActivate: false },
  { id: "account", panel: "account", enterToActivate: false },
  { id: "tree", panel: "tree", enterToActivate: false },
  { id: "files", panel: "files", enterToActivate: false },
  { id: "history", panel: "history", enterToActivate: false },
  { id: "open-window", panel: null, enterToActivate: true },
  { id: "new-chat", panel: null, enterToActivate: true },
];

/** Group pages keep the familiar composer chrome but expose only read-only surfaces. */
export const GROUP_PREVIEW_TOOLBAR_ITEMS: ToolbarItemDef[] = [
  { id: "model", panel: "model", enterToActivate: false },
  { id: "history", panel: "history", enterToActivate: false },
  { id: "files", panel: "files", enterToActivate: false },
  { id: "account", panel: "account", enterToActivate: false },
  { id: "return-chat", panel: null, enterToActivate: true },
];

/** Right-side band the toolbar may occupy — left remainder stays empty. */
export const TOOLBAR_BAND_RATIO = 0.8;

/** Remove-first order when the bar is wider than the 80% band.
 *  open-window 排得早:窄屏(手机)上拖拽小窗本就勉强,先让位。 */
export const TOOLBAR_TRIM_ORDER: ToolbarItemId[] = [
  "tree",
  "open-window",
  "account",
  "model",
  "files",
  "history",
];

/** Never dropped — commands + new-chat stay(手机再窄也得能新建会话);
 *  send lives in the input row below. */
export const TOOLBAR_PROTECTED: ToolbarItemId[] = ["commands", "new-chat", "return-chat"];

export function getRootFontPx(): number {
  if (typeof document === "undefined") return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function toolbarBtnWidthPx(rootFontPx?: number): number {
  const fontPx = rootFontPx ?? getRootFontPx();
  // Matches design.css: 22rem bar / 7 desktop slots — button size stays constant.
  return (22 / 7) * fontPx;
}

/** Mobile buttons can grow with the user's font size, but we cap them so the
 *  toolbar does not collapse to one or two giant buttons on a phone. */
export const MOBILE_TOOLBAR_BTN_MAX_PX = 54;

/** Drop at most one toolbar item when the button row exceeds the 80% band. */
export function trimOneToolbarItem(
  items: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  if (bandWidthPx <= 0 || btnWidthPx <= 0 || items.length * btnWidthPx <= bandWidthPx) return items;
  const drop = TOOLBAR_TRIM_ORDER.find(
    (id) => !TOOLBAR_PROTECTED.includes(id) && items.some((item) => item.id === id),
  );
  if (!drop) {
    const fallback = items.filter((item) => TOOLBAR_PROTECTED.includes(item.id));
    return fallback.length > 0 ? fallback : items.slice(0, 1);
  }
  return items.filter((item) => item.id !== drop);
}

/** Restore at most one toolbar item (reverse trim order) when the band has room. */
export function restoreOneToolbarItem(
  items: ToolbarItemDef[],
  base: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  if (bandWidthPx <= 0 || btnWidthPx <= 0) return items;
  const missing = base.filter((b) => !items.some((i) => i.id === b.id));
  if (missing.length === 0) return items;
  for (const id of [...TOOLBAR_TRIM_ORDER].reverse()) {
    if (TOOLBAR_PROTECTED.includes(id)) continue;
    if (!missing.some((m) => m.id === id)) continue;
    const restored = base.filter((b) => items.some((i) => i.id === b.id) || b.id === id);
    if (restored.length * btnWidthPx <= bandWidthPx) return restored;
  }
  return items;
}

/** One step toward fitting the button row in the 80% band — never batch-trims. */
export function adjustToolbarItemsForBand(
  current: ToolbarItemDef[],
  base: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  const ordered = base.filter((b) => current.some((i) => i.id === b.id));
  const items = ordered.length > 0 ? ordered : [...base];
  if (items.length * btnWidthPx > bandWidthPx) {
    return trimOneToolbarItem(items, bandWidthPx, btnWidthPx);
  }
  return restoreOneToolbarItem(items, base, bandWidthPx, btnWidthPx);
}

/** @deprecated Use adjustToolbarItemsForBand — kept for tests simulating repeated resize steps. */
export function fitToolbarItemsToBand(
  items: ToolbarItemDef[],
  bandWidthPx: number,
  btnWidthPx: number,
): ToolbarItemDef[] {
  let kept = [...items];
  while (kept.length * btnWidthPx > bandWidthPx) {
    const next = trimOneToolbarItem(kept, bandWidthPx, btnWidthPx);
    if (next.length === kept.length) break;
    kept = next;
  }
  return kept;
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

