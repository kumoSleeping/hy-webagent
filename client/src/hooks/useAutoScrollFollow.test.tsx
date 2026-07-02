/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useAutoScrollFollow } from "./useAutoScrollFollow";

beforeAll(() => {
  class MockResizeObserver {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

function ScrollHarness({ resetKey }: { resetKey: string | null }) {
  const { scrollRef, contentRef } = useAutoScrollFollow({ resetKey });
  return (
    <div ref={scrollRef} data-testid="scroll" style={{ height: 100, overflow: "auto" }}>
      <div ref={contentRef} data-testid="content" style={{ height: 400 }} />
    </div>
  );
}

describe("useAutoScrollFollow", () => {
  it("scrolls to bottom when resetKey changes even if starting at top", () => {
    const { getByTestId, rerender } = render(<ScrollHarness resetKey={null} />);
    const scroll = getByTestId("scroll") as HTMLDivElement;

    expect(scroll.scrollTop).toBe(0);

    rerender(<ScrollHarness resetKey="session-a" />);

    expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  });
});
