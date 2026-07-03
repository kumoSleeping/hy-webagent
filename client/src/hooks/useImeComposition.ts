import { useCallback, useRef, type CompositionEvent, type KeyboardEvent } from "react";

type CompositionCommit = (value: string, caret: number | null) => void;

/**
 * IME-safe helpers for controlled text fields.
 *
 * iOS Safari is especially fragile: controlled `value` + caret restoration
 * during composition duplicates glyphs, and preventDefault on Enter blocks
 * candidate selection. Callers must skip caret/layout side-effects while
 * `isComposingActive()` is true and never preventDefault on Enter when composing.
 */
export function useImeComposition(onCompositionCommit?: CompositionCommit) {
  const composingRef = useRef(false);

  const isComposingActive = useCallback(() => composingRef.current, []);

  const imeProps = {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: (e: CompositionEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget;
      if (!target) return;
      // iOS commits the final glyph after compositionEnd — sync state on the
      // next microtask so React catches up before caret-restore effects run.
      // Keep composingRef true until the commit finishes so controlled caret
      // restoration does not run against stale positions (dictation/IME reorder).
      const { value, selectionStart } = target;
      queueMicrotask(() => {
        onCompositionCommit?.(value, selectionStart);
        composingRef.current = false;
      });
    },
    onBlur: () => {
      composingRef.current = false;
    },
  };

  /** True while an IME session is open. Do not rely on keyCode 229 — iOS misreports it on Enter. */
  function isComposing(e: KeyboardEvent): boolean {
    return composingRef.current || e.nativeEvent.isComposing;
  }

  return { imeProps, isComposing, isComposingActive, composingRef };
}
