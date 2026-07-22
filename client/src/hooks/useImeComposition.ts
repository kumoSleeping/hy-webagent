import { useCallback, useRef, type CompositionEvent, type KeyboardEvent } from "react";

type CompositionCommit = (value: string, caret: number | null) => void;

/**
 * IME-safe helpers for text fields.
 *
 * iOS Safari is especially fragile during composition: caret restoration can
 * duplicate glyphs, and preventDefault on Enter blocks candidate selection.
 * Callers must skip caret/layout side-effects while `isComposingActive()` is
 * true and never preventDefault on Enter when composing.
 */
function defaultReadValue(target: HTMLElement): string {
  if ("value" in target && typeof target.value === "string") return target.value;
  return target.textContent ?? "";
}

export function useImeComposition<T extends HTMLElement = HTMLTextAreaElement>(
  onCompositionCommit?: CompositionCommit,
  readValue: (target: T) => string = defaultReadValue,
) {
  const composingRef = useRef(false);

  const isComposingActive = useCallback(() => composingRef.current, []);

  const imeProps = {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (e: CompositionEvent<T>) => {
      const target = e.currentTarget;
      if (!target) return;
      // iOS commits the final glyph after compositionEnd — sync state on the
      // next microtask so React catches up before caret-restore effects run.
      // Keep composingRef true until the commit finishes so controlled caret
      // restoration does not run against stale positions (dictation/IME reorder).
      queueMicrotask(() => {
        const value = readValue(target);
        const selection = window.getSelection();
        const selectionStart = "selectionStart" in target && typeof target.selectionStart === "number"
          ? target.selectionStart
          : selection && target.contains(selection.anchorNode)
            ? selection.anchorOffset
            : null;
        onCompositionCommit?.(value, selectionStart);
        composingRef.current = false;
      });
    },
    onBlur: () => {
      composingRef.current = false;
    },
  };

  /** True while an IME session is open. Do not rely on keyCode 229 — iOS misreports it on Enter. */
  function isComposing(e: KeyboardEvent<T>): boolean {
    return composingRef.current || e.nativeEvent.isComposing;
  }

  return { imeProps, isComposing, isComposingActive, composingRef };
}
