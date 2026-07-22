import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CompositionEventHandler,
  type FormEventHandler,
  type HTMLAttributes,
} from "react";
import { splitTextWithMarkers } from "../../lib/compressedText";

export interface ComposerEditorHandle {
  readonly element: HTMLDivElement | null;
  value: string;
  readOnly: boolean;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus: (options?: FocusOptions) => void;
  blur: () => void;
  setSelectionRange: (start: number, end: number) => void;
  insertText: (text: string) => void;
}

interface StableComposerEditorProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "contentEditable" | "defaultValue" | "onInput"> {
  initialValue: string;
  autoComplete?: string;
  autoCorrect?: string;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  onInput?: FormEventHandler<HTMLDivElement>;
  onCompositionStart?: CompositionEventHandler<HTMLDivElement>;
  onCompositionEnd?: CompositionEventHandler<HTMLDivElement>;
  onValueChange: (value: string) => void;
}

function readValue(element: HTMLDivElement | null): string {
  return element?.textContent ?? "";
}

function writeValue(element: HTMLDivElement, value: string) {
  const nodes: Node[] = [];
  for (const part of splitTextWithMarkers(value)) {
    if (part.kind === "text") {
      nodes.push(document.createTextNode(part.value));
      continue;
    }
    const marker = document.createElement("span");
    marker.className = "pi-composer-text-token";
    marker.contentEditable = "false";
    marker.textContent = part.value;
    nodes.push(marker, document.createTextNode(""));
  }
  element.replaceChildren(...nodes);
}

function selectionOffset(element: HTMLDivElement, edge: "anchor" | "focus"): number {
  const selection = window.getSelection();
  const node = edge === "anchor" ? selection?.anchorNode : selection?.focusNode;
  const offset = edge === "anchor" ? selection?.anchorOffset : selection?.focusOffset;
  if (!selection || !node || offset == null || !element.contains(node)) return readValue(element).length;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

function textPosition(element: HTMLDivElement, requestedOffset: number): { node: Node; offset: number } {
  const targetOffset = Math.max(0, Math.min(requestedOffset, readValue(element).length));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = targetOffset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    const token = node.parentElement?.closest(".pi-composer-text-token");
    if (token && element.contains(token) && remaining <= length) {
      const parent = token.parentNode;
      if (parent) {
        const tokenIndex = Array.prototype.indexOf.call(parent.childNodes, token) as number;
        return { node: parent, offset: tokenIndex + (remaining === 0 ? 0 : 1) };
      }
    }
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }

  const textNode = document.createTextNode("");
  element.append(textNode);
  return { node: textNode, offset: 0 };
}

function setSelection(element: HTMLDivElement, start: number, end: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const startPosition = textPosition(element, start);
  const endPosition = textPosition(element, end);
  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Browser-owned plaintext editor using WebKit's contenteditable input path. */
export const StableComposerEditor = forwardRef<ComposerEditorHandle, StableComposerEditorProps>(
  function StableComposerEditor({
    initialValue,
    autoComplete,
    autoCorrect,
    disabled = false,
    readOnly = false,
    placeholder,
    onCompositionEnd,
    onCompositionStart,
    onInput,
    onValueChange,
    ...props
  }, forwardedRef) {
    const elementRef = useRef<HTMLDivElement>(null);
    const initialValueRef = useRef(initialValue);
    const composingRef = useRef(false);
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;

    useLayoutEffect(() => {
      const element = elementRef.current;
      if (!element) return;
      writeValue(element, initialValueRef.current);
    }, []);

    useLayoutEffect(() => {
      const element = elementRef.current;
      if (!element) return;
      if (autoComplete) element.setAttribute("autocomplete", autoComplete);
      else element.removeAttribute("autocomplete");
      if (autoCorrect) element.setAttribute("autocorrect", autoCorrect);
      else element.removeAttribute("autocorrect");
    }, [autoComplete, autoCorrect]);

    useImperativeHandle(forwardedRef, () => ({
      get element() {
        return elementRef.current;
      },
      get value() {
        return readValue(elementRef.current);
      },
      set value(value: string) {
        const element = elementRef.current;
        if (element && readValue(element) !== value) writeValue(element, value);
      },
      get readOnly() {
        return readOnlyRef.current;
      },
      set readOnly(value: boolean) {
        readOnlyRef.current = value;
        const element = elementRef.current;
        if (element) element.contentEditable = disabled || value ? "false" : "plaintext-only";
      },
      get selectionStart() {
        const element = elementRef.current;
        if (!element) return 0;
        return Math.min(selectionOffset(element, "anchor"), selectionOffset(element, "focus"));
      },
      get selectionEnd() {
        const element = elementRef.current;
        if (!element) return 0;
        return Math.max(selectionOffset(element, "anchor"), selectionOffset(element, "focus"));
      },
      focus(options?: FocusOptions) {
        elementRef.current?.focus(options);
      },
      blur() {
        elementRef.current?.blur();
      },
      setSelectionRange(start: number, end: number) {
        const element = elementRef.current;
        if (element) setSelection(element, start, end);
      },
      insertText(text: string) {
        const element = elementRef.current;
        const selection = window.getSelection();
        if (!element || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.commonAncestorContainer)) return;
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      },
    }), [disabled]);

    return (
      <div
        {...props}
        ref={elementRef}
        role="textbox"
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        aria-readonly={readOnly || undefined}
        contentEditable={disabled || readOnly ? false : "plaintext-only"}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onCompositionStart={(event) => {
          composingRef.current = true;
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd?.(event);
          queueMicrotask(() => {
            composingRef.current = false;
          });
        }}
        onInput={(event) => {
          if (!composingRef.current) {
            const value = readValue(event.currentTarget);
            if (!value) event.currentTarget.replaceChildren();
            onValueChange(value);
          }
          onInput?.(event);
        }}
      />
    );
  },
);
