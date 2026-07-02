import { describe, it, expect } from "vitest";
import { WebWidgetHost, type WidgetSnapshot } from "../pi/web-widget-host.js";

function snapshotAfter(setup: (host: WebWidgetHost) => void): WidgetSnapshot {
  let latest: WidgetSnapshot = { aboveEditor: {}, belowEditor: {} };
  const host = new WebWidgetHost((s) => { latest = s; });
  setup(host);
  // getSnapshot is the source of truth pushed to clients.
  latest = host.getSnapshot();
  host.dispose();
  return latest;
}

describe("WebWidgetHost.getSnapshot", () => {
  it("omits widgets whose rendered content is empty or whitespace-only", () => {
    const snap = snapshotAfter((host) => {
      host.setWidget("ghost", ["   ", "", "\u00A0"], { placement: "aboveEditor" });
    });
    expect(snap.aboveEditor).toEqual({});
    expect(snap.belowEditor).toEqual({});
  });

  it("keeps widgets that carry visible content", () => {
    const snap = snapshotAfter((host) => {
      host.setWidget("goal", ["GOAL ship the fix", ""], { placement: "aboveEditor" });
    });
    expect(snap.aboveEditor.goal).toEqual(["GOAL ship the fix", ""]);
  });

  it("routes below-editor widgets to the right slot", () => {
    const snap = snapshotAfter((host) => {
      host.setWidget("timer", ["00:42"], { placement: "belowEditor" });
    });
    expect(snap.belowEditor.timer).toEqual(["00:42"]);
    expect(snap.aboveEditor).toEqual({});
  });

  it("re-renders factory widgets when render width changes", () => {
    let latest: WidgetSnapshot = { aboveEditor: {}, belowEditor: {} };
    const host = new WebWidgetHost((s) => { latest = s; });
    host.setWidget("demo", (_tui, _theme) => ({
      render(width: number) {
        return [`w=${width}`];
      },
    }), { placement: "aboveEditor" });
    expect(latest.aboveEditor.demo).toEqual(["w=64"]);
    host.setRenderWidth(80);
    expect(latest.aboveEditor.demo).toEqual(["w=80"]);
    host.dispose();
  });
});
