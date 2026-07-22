import { describe, expect, it, vi } from "vitest";
import { ExtensionUIBridge } from "../pi/extension-ui-bridge.js";
import { WebWidgetHost } from "../pi/web-widget-host.js";
import {
  createWebExtensionUIContext,
  type ServerToolActivityPayload,
  type WebExtensionUIContext,
} from "../pi/web-ui-context.js";

describe("web extension UI context", () => {
  it("forwards structured server-tool activity to the host", () => {
    const onServerTool = vi.fn();
    const context = createWebExtensionUIContext({
      bridge: new ExtensionUIBridge(() => {}),
      widgetHost: new WebWidgetHost(() => {}),
      onStatus: () => {},
      onServerTool,
    }) as WebExtensionUIContext;
    const activity: ServerToolActivityPayload = {
      phase: "start",
      toolCallId: "search-1",
      toolName: "web_search",
      input: { query: "latest news" },
    };

    context.emitServerToolActivity?.(activity);

    expect(onServerTool).toHaveBeenCalledWith(activity);
  });
});
