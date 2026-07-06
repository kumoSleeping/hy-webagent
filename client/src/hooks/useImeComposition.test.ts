import { describe, expect, it, vi } from "vitest";
import type { CompositionEvent, KeyboardEvent } from "react";
import { renderHook } from "@testing-library/react";
import { useImeComposition } from "./useImeComposition";

function enterKeyDown(isComposing = false) {
  return {
    key: "Enter",
    shiftKey: false,
    keyCode: 229,
    nativeEvent: { isComposing },
  } as unknown as KeyboardEvent;
}

function compositionEnd(value: string, selectionStart = value.length) {
  return {
    currentTarget: { value, selectionStart },
  } as unknown as CompositionEvent<HTMLTextAreaElement>;
}

describe("useImeComposition", () => {
  it("treats native isComposing as active IME", () => {
    const { result } = renderHook(() => useImeComposition());
    expect(result.current.isComposing(enterKeyDown(true))).toBe(true);
  });

  it("does not block Enter solely because keyCode is 229", () => {
    const { result } = renderHook(() => useImeComposition());
    expect(result.current.isComposing(enterKeyDown(false))).toBe(false);
  });

  it("tracks composition lifecycle via imeProps", () => {
    const { result } = renderHook(() => useImeComposition());
    const props = result.current.imeProps;

    props.onCompositionStart?.();
    expect(result.current.isComposingActive()).toBe(true);
    expect(result.current.isComposing(enterKeyDown(false))).toBe(true);

    props.onCompositionEnd?.(compositionEnd(""));
    expect(result.current.isComposingActive()).toBe(true);
    expect(result.current.isComposing(enterKeyDown(false))).toBe(true);
  });

  it("commits composed value on the next microtask after compositionEnd", async () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useImeComposition(onCommit));

    result.current.imeProps.onCompositionStart?.();
    result.current.imeProps.onCompositionEnd?.(compositionEnd("你好"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.isComposingActive()).toBe(true);

    await Promise.resolve();
    expect(onCommit).toHaveBeenCalledWith("你好", 2);
    expect(result.current.isComposingActive()).toBe(false);
  });
});
