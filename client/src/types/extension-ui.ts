export type ExtensionUIMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text";

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface ExtensionUIRequest {
  id: string;
  method: ExtensionUIMethod;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string | null;
  widgetKey?: string;
  widgetLines?: string[] | null;
  widgetPlacement?: WidgetPlacement;
  text?: string;
  timeout?: number;
}

export interface ExtensionUIResponse {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

export type ExtensionDialogState = Pick<
  ExtensionUIRequest,
  "id" | "method" | "title" | "message" | "options" | "placeholder" | "prefill"
> & {
  method: "select" | "confirm" | "input" | "editor";
};
