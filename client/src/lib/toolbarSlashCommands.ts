import type { ComposerPanelKind } from "../stores/composerPanelStore";
import { useComposerPanelStore } from "../stores/composerPanelStore";

export type TreePanelMode = "tree" | "fork";

export interface ToolbarSlashAction {
  panel: Exclude<ComposerPanelKind, null | "commands">;
  treeMode?: TreePanelMode;
  fetchSessions?: boolean;
}

/** Bare slash commands that open an existing composer toolbar panel. */
export function resolveToolbarSlash(text: string): ToolbarSlashAction | null {
  if (!text.startsWith("/")) return null;
  const trimmed = text.slice(1).trim();
  const [id, ...rest] = trimmed.split(/\s+/);
  const argText = rest.join(" ").trim();
  if (!id || argText) return null;

  switch (id.toLowerCase()) {
    case "resume":
      return { panel: "history", fetchSessions: true };
    case "tree":
      return { panel: "tree", treeMode: "tree" };
    case "fork":
      return { panel: "tree", treeMode: "fork" };
    case "model":
      return { panel: "model" };
    default:
      return null;
  }
}

export function openToolbarSlashPanel(action: ToolbarSlashAction): void {
  const store = useComposerPanelStore.getState();
  if (action.panel === "tree") {
    store.openTreePanel(action.treeMode ?? "tree");
    return;
  }
  if (action.panel === "model") {
    store.openModelPanel();
    return;
  }
  store.setPanel(action.panel);
}
