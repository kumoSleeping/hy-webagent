import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessTrace } from "./ProcessTrace";

afterEach(() => vi.useRealTimers());

describe("ProcessTrace", () => {
  it("uses the same process styling for status narration and thinking", () => {
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
    expect(screen.getByText("第一轮思考")).toBeVisible();
  });

  it("never auto-collapses a process that was live", () => {
    const items = [{ kind: "thinking" as const, text: "持续显示的思考" }];
    const { rerender } = render(
      <ProcessTrace items={items} isActive activeIndex={0} />,
    );

    rerender(<ProcessTrace items={items} isActive={false} activeIndex={null} />);
    expect(screen.getByText("持续显示的思考")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Working process · 0s" }));
    expect(screen.queryByText("持续显示的思考")).not.toBeInTheDocument();
  });

  it("keeps fresh history collapsed until the user opens it", () => {
    render(
      <ProcessTrace
        items={[{ kind: "thinking", text: "历史思考" }]}
        isActive={false}
        activeIndex={null}
        durationMs={12_000}
      />,
    );

    expect(screen.queryByText("历史思考")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Working process · 12s" }));
    expect(screen.getByText("历史思考")).toBeVisible();
  });

  it("does not auto-collapse a tool after the next step starts", () => {
    const runningTool = {
      kind: "tool" as const,
      tool: {
        toolCallId: "tool-1",
        toolName: "bash",
        input: { command: "pwd" },
        status: "running" as const,
      },
    };
    const { rerender } = render(
      <ProcessTrace items={[runningTool]} isActive activeIndex={0} />,
    );
    expect(screen.getByText("Running…")).toBeVisible();

    rerender(
      <ProcessTrace
        items={[
          { ...runningTool, tool: { ...runningTool.tool, status: "done", output: "/workspace" } },
          { kind: "thinking", text: "继续分析" },
        ]}
        isActive
        activeIndex={1}
      />,
    );
    expect(screen.getByText("/workspace")).toBeVisible();
  });
});
