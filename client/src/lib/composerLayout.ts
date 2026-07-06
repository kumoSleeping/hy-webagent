import type { ComposerPanelKind } from "../stores/composerPanelStore";
import type { ReactNode } from "react";

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

export function toolbarItemsForLayout(isMobile: boolean): ToolbarItemDef[] {
  return isMobile ? MOBILE_TOOLBAR_ITEMS : DESKTOP_TOOLBAR_ITEMS;
}

export function panelToolbarIndex(panel: Exclude<ComposerPanelKind, null>, isMobile: boolean): number {
  const items = toolbarItemsForLayout(isMobile);
  const idx = items.findIndex((item) => item.panel === panel);
  return idx >= 0 ? idx : 0;
}

/** Panels that expand in the center stage stack instead of the composer popup. */
export function isElevatedPanel(panel: ComposerPanelKind | null, isMobile: boolean): boolean {
  if (!panel) return false;
  if (panel === "tree") return true;
  if (!isMobile) return false;
  return panel === "commands" || panel === "files" || panel === "history" || panel === "model" || panel === "account";
}

export function panelChromeLabel(panel: Exclude<ComposerPanelKind, null>): string {
  switch (panel) {
    case "commands":
      return "Commands";
    case "files":
      return "Files";
    case "history":
      return "History";
    case "model":
      return "Model";
    case "account":
      return "Account";
    case "tree":
      return "Tree";
    default:
      return "Panel";
  }
}

export interface MobileComposerPanel {
  panel: Exclude<ComposerPanelKind, null>;
  label: string;
  content: ReactNode;
}
