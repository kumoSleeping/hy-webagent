import { randomUUID } from "node:crypto";
import type { ExtensionUIRequest, ExtensionUIResponse } from "./extension-ui-types.js";

type PendingEntry = {
  resolve: (response: ExtensionUIResponse) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type ExtensionUIEmit = (request: ExtensionUIRequest) => void;

/** Bridges blocking extension UI calls to the connected WebSocket client. */
export class ExtensionUIBridge {
  private pending = new Map<string, PendingEntry>();

  constructor(private emit: ExtensionUIEmit) {}

  dispose() {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error("Extension UI bridge disposed"));
    }
    this.pending.clear();
  }

  handleResponse(response: ExtensionUIResponse) {
    const entry = this.pending.get(response.id);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(response.id);
    entry.resolve(response);
    return true;
  }

  fireAndForget(request: Omit<ExtensionUIRequest, "id">) {
    this.emit({ id: randomUUID(), ...request });
  }

  private dialog<T>(
    request: Omit<ExtensionUIRequest, "id">,
    parse: (response: ExtensionUIResponse) => T,
    defaultValue: T
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = (response: ExtensionUIResponse) => {
        resolve(parse(response));
      };

      const entry: PendingEntry = {
        resolve: cleanup,
        reject,
      };

      if (request.timeout && request.timeout > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          resolve(defaultValue);
        }, request.timeout);
      }

      this.pending.set(id, entry);
      this.emit({ id, ...request });
    });
  }

  select(title: string, options: string[], opts?: { timeout?: number }) {
    return this.dialog(
      { method: "select", title, options, timeout: opts?.timeout },
      (r) => (r.cancelled ? undefined : r.value),
      undefined as string | undefined
    );
  }

  confirm(title: string, message?: string, opts?: { timeout?: number }) {
    return this.dialog(
      { method: "confirm", title, message, timeout: opts?.timeout },
      (r) => (r.cancelled ? false : Boolean(r.confirmed)),
      false
    );
  }

  input(title: string, placeholder?: string, opts?: { timeout?: number }) {
    return this.dialog(
      { method: "input", title, placeholder, timeout: opts?.timeout },
      (r) => (r.cancelled ? undefined : r.value),
      undefined as string | undefined
    );
  }

  editor(title: string, prefill?: string, opts?: { timeout?: number }) {
    return this.dialog(
      { method: "editor", title, prefill, timeout: opts?.timeout },
      (r) => (r.cancelled ? undefined : r.value),
      undefined as string | undefined
    );
  }
}
