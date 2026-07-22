import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIBridge } from "./extension-ui-bridge.js";
import type { WebWidgetHost } from "./web-widget-host.js";

/** Plain-text theme stub — extensions may call theme.fg(); web strips ANSI anyway. */
const webTheme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
};

export interface StatusUpdatePayload {
  key: string;
  text: string | null;
}

export interface WorkingUpdatePayload {
  message: string | null;
  visible: boolean;
}

/** Strip ANSI escape sequences from pi theme.fg() output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Match native footer status sanitization. */
export function sanitizeStatusText(text: string): string {
  return stripAnsi(text)
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export interface WebExtensionUIOptions {
  bridge: ExtensionUIBridge;
  widgetHost: WebWidgetHost;
  onStatus: (update: StatusUpdatePayload) => void;
  onWorking?: (update: WorkingUpdatePayload) => void;
}

export function createWebExtensionUIContext({
  bridge,
  widgetHost,
  onStatus,
  onWorking,
}: WebExtensionUIOptions): ExtensionUIContext {
  let workingMessage: string | null = null;
  let workingVisible = true;

  const pushWorking = () => {
    onWorking?.({
      message: workingVisible ? workingMessage : null,
      visible: workingVisible && !!workingMessage,
    });
  };

  const context: ExtensionUIContext = {
    select: (title, options, opts) => bridge.select(title, options, opts),
    confirm: (title, message, opts) => bridge.confirm(title, message, opts),
    input: (title, placeholder, opts) => bridge.input(title, placeholder, opts),
    notify(message, type) {
      bridge.fireAndForget({ method: "notify", message, notifyType: type });
    },
    onTerminalInput: () => () => {},
    setStatus(key, text) {
      const clean = text === undefined ? null : sanitizeStatusText(text);
      onStatus({ key, text: clean || null });
    },
    setWorkingMessage(message?: string) {
      if (message === undefined || message === null) {
        workingMessage = null;
      } else {
        const clean = sanitizeStatusText(message);
        workingMessage = clean || null;
      }
      pushWorking();
    },
    setWorkingVisible(visible: boolean) {
      workingVisible = !!visible;
      pushWorking();
    },
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: widgetHost.bindSetWidget(),
    setFooter: () => {},
    setHeader: () => {},
    setTitle(title) {
      bridge.fireAndForget({ method: "setTitle", title });
    },
    custom: (async () => undefined) as ExtensionUIContext["custom"],
    pasteToEditor(text) {
      bridge.fireAndForget({ method: "set_editor_text", text });
    },
    setEditorText(text) {
      bridge.fireAndForget({ method: "set_editor_text", text });
    },
    getEditorText: () => "",
    editor: (title, prefill) => bridge.editor(title, prefill),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return webTheme as ExtensionUIContext["theme"];
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "UI not available" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
  return context;
}
