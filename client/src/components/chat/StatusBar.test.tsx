import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ExtensionWidgetPanel } from "./StatusBar";
import { useStatusBarStore } from "../../stores/statusBarStore";

function setAbove(aboveEditor: Record<string, string[]>) {
  useStatusBarStore.setState({ widgets: { aboveEditor, belowEditor: {} } });
}

describe("ExtensionWidgetPanel", () => {
  beforeEach(() => {
    useStatusBarStore.getState().clear();
  });

  it("renders nothing when there are no widgets", () => {
    const { container } = render(<ExtensionWidgetPanel />);
    expect(container.querySelector(".pi-extension-widget")).toBeNull();
  });

  it("does not render a ghost card for a blank/whitespace-only widget", () => {
    setAbove({ goal: ["   ", "", "\u00A0"] });
    const { container } = render(<ExtensionWidgetPanel />);
    expect(container.querySelector(".pi-extension-widgets")).toBeNull();
    expect(container.querySelector(".pi-extension-widget")).toBeNull();
  });

  it("renders a widget that carries visible content and trims blank edges", () => {
    setAbove({ goal: ["", "GOAL  ship the fix", "STEP  2/3", "  "] });
    const { container } = render(<ExtensionWidgetPanel />);
    const widget = container.querySelector(".pi-extension-widget");
    expect(widget).not.toBeNull();
    const lines = widget!.querySelectorAll(".pi-extension-widget-line");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe("GOAL  ship the fix");
    expect(lines[1]!.textContent).toBe("STEP  2/3");
  });

  it("keeps meaningful interior blank lines between content", () => {
    setAbove({ goal: ["A", "", "B"] });
    const { container } = render(<ExtensionWidgetPanel />);
    const lines = container.querySelectorAll(".pi-extension-widget-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.textContent).toBe("A");
    // interior blank preserved (rendered as NBSP placeholder)
    expect(lines[1]!.textContent).toBe("\u00A0");
    expect(lines[2]!.textContent).toBe("B");
  });
});
