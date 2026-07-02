import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorAutoSave } from "./useEditorAutoSave";

describe("useEditorAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces writes until typing pauses", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const tabs = [{ id: "a.md", path: "a.md", content: "v1" }];

    const { result, rerender } = renderHook(
      ({ t }) => useEditorAutoSave(t, writeFile),
      { initialProps: { t: tabs } }
    );

    act(() => {
      result.current.scheduleSave("a.md", "v2");
    });
    expect(writeFile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(writeFile).toHaveBeenCalledWith("a.md", "v2");

    rerender({ t: [{ id: "a.md", path: "a.md", content: "v2" }] });
    act(() => {
      result.current.scheduleSave("a.md", "v2");
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("flushSave writes immediately", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const tabs = [{ id: "a.md", path: "a.md", content: "v1" }];

    const { result } = renderHook(
      () => useEditorAutoSave(tabs, writeFile)
    );

    await act(async () => {
      await result.current.flushSave("a.md", "saved");
    });
    expect(writeFile).toHaveBeenCalledWith("a.md", "saved");
  });
});
