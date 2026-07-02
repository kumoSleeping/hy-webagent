import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "./web-ui-context.js";

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface WidgetSnapshot {
  aboveEditor: Record<string, string[]>;
  belowEditor: Record<string, string[]>;
}

interface WidgetEntry {
  key: string;
  placement: WidgetPlacement;
  component?: { render(width: number): string[]; dispose?(): void };
  lines?: string[];
}

/** Minimal theme — extensions call theme.fg(); web strips ANSI from rendered output. */
const webTheme: Theme = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
} as Theme;

const DEFAULT_WIDTH = 64;

export class WebWidgetHost {
  private widgets = new Map<string, WidgetEntry>();
  private renderWidth = DEFAULT_WIDTH;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotJson = "";
  private onUpdate: (snapshot: WidgetSnapshot) => void;

  constructor(onUpdate: (snapshot: WidgetSnapshot) => void) {
    this.onUpdate = onUpdate;
  }

  setRenderWidth(width: number) {
    const next = Math.max(40, Math.min(120, Math.round(width)));
    if (next === this.renderWidth) return;
    this.renderWidth = next;
    this.pushUpdate();
  }

  getRenderWidth() {
    return this.renderWidth;
  }

  dispose() {
    this.stopTick();
    for (const entry of this.widgets.values()) {
      entry.component?.dispose?.();
    }
    this.widgets.clear();
  }

  getSnapshot(): WidgetSnapshot {
    const aboveEditor: Record<string, string[]> = {};
    const belowEditor: Record<string, string[]> = {};

    for (const entry of this.widgets.values()) {
      const raw = entry.component
        ? entry.component.render(this.renderWidth)
        : entry.lines ?? [];
      const lines = raw.map((line) => stripAnsi(line).replace(/\u00A0/g, " "));
      // Skip widgets that render no visible content (empty or whitespace-only).
      // An idle widget emitting a blank spacer line would otherwise surface as
      // an empty "ghost" card above/below the composer.
      if (!lines.some((line) => line.trim().length > 0)) continue;
      const target = entry.placement === "aboveEditor" ? aboveEditor : belowEditor;
      target[entry.key] = lines;
    }

    return { aboveEditor, belowEditor };
  }

  private pushUpdate() {
    const snap = this.getSnapshot();
    const json = JSON.stringify(snap);
    if (json === this.lastSnapshotJson) return;
    this.lastSnapshotJson = json;
    this.onUpdate(snap);
  }

  private schedulePush() {
    this.pushUpdate();
    this.ensureTick();
  }

  private ensureTick() {
    if (this.widgets.size === 0) {
      this.stopTick();
      return;
    }
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.pushUpdate(), 250);
  }

  private stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  setWidget(
    key: string,
    content: string[] | ((tui: { requestRender(): void }, theme: Theme) => { render(width: number): string[]; dispose?(): void }) | undefined,
    options?: { placement?: WidgetPlacement }
  ) {
    const existing = this.widgets.get(key);
    existing?.component?.dispose?.();

    if (content === undefined) {
      this.widgets.delete(key);
      this.pushUpdate();
      if (this.widgets.size === 0) this.stopTick();
      return;
    }

    const placement = options?.placement ?? "aboveEditor";

    if (Array.isArray(content)) {
      this.widgets.set(key, { key, placement, lines: content });
    } else {
      const mockTui = { requestRender: () => this.schedulePush() };
      const component = content(mockTui, webTheme);
      this.widgets.set(key, { key, placement, component });
    }

    this.schedulePush();
  }

  /** Match ExtensionUIContext.setWidget signature for web-ui-context. */
  bindSetWidget(): ExtensionUIContext["setWidget"] {
    return (key, content, options) => {
      if (content === undefined) {
        this.setWidget(String(key), undefined);
        return;
      }
      if (Array.isArray(content)) {
        this.setWidget(String(key), content, options);
        return;
      }
      if (typeof content === "function") {
        type WidgetFactory = (
          tui: { requestRender(): void },
          theme: Theme
        ) => { render(width: number): string[]; dispose?(): void };
        this.setWidget(String(key), content as unknown as WidgetFactory, options);
      }
    };
  }
}
