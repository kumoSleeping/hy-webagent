import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessTrace } from "./ProcessTrace";

afterEach(() => vi.useRealTimers());

describe("ProcessTrace", () => {
  it("keeps status narration dark and renders thinking in muted grey", () => {
    render(
      <ProcessTrace
        items={[
          { kind: "status", text: "正在检查项目结构" },
          { kind: "thinking", text: "需要比较两个实现方案" },
        ]}
        isActive
        activeIndex={1}
      />,
    );

    expect(screen.getByText("正在检查项目结构")).toHaveClass("pi-process-step-text--status");
    expect(screen.getByText("需要比较两个实现方案")).toHaveClass("pi-process-step-text--thinking");
  });

  it("keeps one wall-clock timer across multiple tool rounds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { rerender } = render(
      <ProcessTrace
        items={[{ kind: "thinking", text: "第一轮思考" }]}
        isActive
        activeIndex={0}
      />,
    );

    act(() => vi.advanceTimersByTime(6_000));
    rerender(
      <ProcessTrace
        items={[
          { kind: "thinking", text: "第一轮思考" },
          { kind: "status", text: "Jina 检索完成，继续分析" },
        ]}
        isActive
        activeIndex={1}
      />,
    );
    act(() => vi.advanceTimersByTime(5_000));
    rerender(
      <ProcessTrace
        items={[
          { kind: "thinking", text: "第一轮思考" },
          { kind: "status", text: "Jina 检索完成，继续分析" },
        ]}
        isActive={false}
        activeIndex={null}
      />,
    );

    expect(screen.getByText("Working process · 11s")).toBeInTheDocument();
  });
});
