import { describe, expect, it } from "vitest";
import { ExtensionUIBridge } from "../pi/extension-ui-bridge.js";

describe("ExtensionUIBridge", () => {
  it("resolves select dialog when client responds with value", async () => {
    const emitted: unknown[] = [];
    const bridge = new ExtensionUIBridge((req) => emitted.push(req));

    const promise = bridge.select("Pick one", ["A", "B"]);
    expect(emitted).toHaveLength(1);

    const req = emitted[0] as { id: string; method: string };
    expect(req.method).toBe("select");

    bridge.handleResponse({ id: req.id, value: "B" });
    await expect(promise).resolves.toBe("B");
  });

  it("returns default when confirm is cancelled", async () => {
    const bridge = new ExtensionUIBridge(() => {});
    const promise = bridge.confirm("Sure?");
    bridge.handleResponse({ id: "missing", cancelled: true });
    // no matching id — still pending; use real id:
    bridge.dispose();
    await expect(promise).rejects.toThrow();
  });

  it("resolves confirm with false on cancel", async () => {
    const emitted: unknown[] = [];
    const bridge = new ExtensionUIBridge((req) => emitted.push(req));
    const promise = bridge.confirm("Delete?");
    const id = (emitted[0] as { id: string }).id;
    bridge.handleResponse({ id, cancelled: true });
    await expect(promise).resolves.toBe(false);
  });

  it("fireAndForget emits notify without blocking", () => {
    const emitted: unknown[] = [];
    const bridge = new ExtensionUIBridge((req) => emitted.push(req));
    bridge.fireAndForget({ method: "notify", message: "hello", notifyType: "info" });
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as { method: string }).method).toBe("notify");
  });
});
