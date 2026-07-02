import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useExtensionUiStore } from "../../stores/extensionUiStore";

export type ExtensionUiResponder = (response: {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}) => void;

interface ExtensionDialogHostProps {
  onRespond: ExtensionUiResponder;
}

export function ExtensionDialogHost({ onRespond }: ExtensionDialogHostProps) {
  const dialog = useExtensionUiStore((s) => s.activeDialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.prefill ?? "");
    requestAnimationFrame(() => {
      if (dialog.method === "editor") textareaRef.current?.focus();
      else inputRef.current?.focus();
    });
  }, [dialog]);

  if (!dialog) return null;

  function cancel() {
    onRespond({ id: dialog!.id, cancelled: true });
    useExtensionUiStore.getState().setDialog(null);
  }

  function submit(next?: string) {
    const id = dialog!.id;
    if (dialog!.method === "confirm") {
      onRespond({ id, confirmed: true });
    } else {
      onRespond({ id, value: next ?? value });
    }
    useExtensionUiStore.getState().setDialog(null);
  }

  const title = dialog.title || "Extension";

  if (dialog.method === "select") {
    return (
      <div className="pi-ext-dialog">
        <p className="pi-ext-dialog-title">{title}</p>
        <div className="pi-ext-dialog-options">
          {(dialog.options ?? []).map((opt) => (
            <button key={opt} type="button" className="pi-ext-dialog-option" onClick={() => submit(opt)}>
              {opt}
            </button>
          ))}
        </div>
        <button type="button" className="pi-ext-dialog-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (dialog.method === "confirm") {
    return (
      <div className="pi-ext-dialog">
        <p className="pi-ext-dialog-title">{title}</p>
        {dialog.message && <p className="pi-ext-dialog-message">{dialog.message}</p>}
        <div className="pi-ext-dialog-actions">
          <button type="button" className="pi-ext-dialog-btn" onClick={cancel}>
            <X size={12} /> No
          </button>
          <button type="button" className="pi-ext-dialog-btn pi-ext-dialog-btn--primary" onClick={() => submit()}>
            <Check size={12} /> Yes
          </button>
        </div>
      </div>
    );
  }

  if (dialog.method === "editor") {
    return (
      <div className="pi-ext-dialog pi-ext-dialog--wide">
        <p className="pi-ext-dialog-title">{title}</p>
        <textarea
          ref={textareaRef}
          className="pi-ext-dialog-editor"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
        />
        <div className="pi-ext-dialog-actions">
          <button type="button" className="pi-ext-dialog-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="pi-ext-dialog-btn pi-ext-dialog-btn--primary" onClick={() => submit()}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pi-ext-dialog">
      <p className="pi-ext-dialog-title">{title}</p>
      <input
        ref={inputRef}
        className="pi-ext-dialog-input"
        value={value}
        placeholder={dialog.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") cancel();
        }}
      />
      <div className="pi-ext-dialog-actions">
        <button type="button" className="pi-ext-dialog-btn" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="pi-ext-dialog-btn pi-ext-dialog-btn--primary" onClick={() => submit()}>
          OK
        </button>
      </div>
    </div>
  );
}
