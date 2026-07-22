import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessTrace } from "./ProcessTrace";

afterEach(() => vi.useRealTimers());

describe("ProcessTrace", () => {
  it("renders process narration with the muted thinking style", () => {
    render(
      <ProcessTrace
        items={[{ kind: "thinking", text: "需要比较两个实现方案" }]}
        isActive activeIndex={0}
      />,
    );

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
          { kind: "thinking", text: "Jina 检索完成，继续分析" },
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
          { kind: "thinking", text: "Jina 检索完成，继续分析" },
        ]}
        isActive={false}
        activeIndex={null}
      />,
    );

    expect(screen.getByText("Working process · 11s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Working process · 11s" }));
    expect(screen.getByText("第一轮思考")).toBeVisible();
  });

  it("auto-collapses as soon as answer streaming starts", () => {
    const items = [{ kind: "thinking" as const, text: "持续显示的思考" }];
    const { rerender } = render(
      <ProcessTrace items={items} isActive activeIndex={0} />,
    );

    rerender(<ProcessTrace items={items} isActive={false} activeIndex={null} />);
    expect(screen.queryByText("持续显示的思考")).not.toBeInTheDocument();
  });

  it("stays collapsed when the surrounding agent later completes", () => {
    const items = [{ kind: "thinking" as const, text: "完整过程" }];
    const { rerender } = render(
      <ProcessTrace items={items} isActive activeIndex={0} />,
    );

    rerender(<ProcessTrace items={items} isActive={false} activeIndex={null} />);
    expect(screen.queryByText("完整过程")).not.toBeInTheDocument();
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

  it("renders web actions as non-expandable rows with their completed input", () => {
    render(
      <ProcessTrace
        items={[{
          kind: "tool",
          tool: {
            toolCallId: "web-1",
            toolName: "web_search",
            input: { type: "search", query: "AI news", sources: [{ url: "a" }] },
            status: "done",
          },
        }]}
        isActive={false}
        activeIndex={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Working process" }));
    expect(screen.getByText("Web Search")).toBeVisible();
    expect(screen.getByText('"AI news" · 1 sources')).toBeVisible();
    expect(screen.queryByRole("button", { name: /Web Search/ })).not.toBeInTheDocument();
  });

  it("labels X/Twitter searches separately from web searches", () => {
    render(
      <ProcessTrace
        items={[{
          kind: "tool",
          tool: {
            toolCallId: "x-1",
            toolName: "x_search",
            input: { type: "search", query: "OpenAI" },
            status: "done",
          },
        }]}
        isActive={false}
        activeIndex={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Working process" }));
    expect(screen.getByText("X Search")).toBeVisible();
    expect(screen.queryByText("Web Search")).not.toBeInTheDocument();
  });

  it("uses readable independent labels for other Grok native tools", () => {
    render(
      <ProcessTrace
        items={[
          { kind: "tool", tool: { toolCallId: "code-1", toolName: "code_interpreter", input: { code: "1 + 1" }, status: "done" } },
          { kind: "tool", tool: { toolCallId: "image-1", toolName: "view_image", input: { url: "https://example.com/a.png" }, status: "done" } },
          { kind: "tool", tool: { toolCallId: "video-1", toolName: "view_x_video", input: { url: "https://x.com/video/1" }, status: "done" } },
        ]}
        isActive={false}
        activeIndex={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Working process" }));
    expect(screen.getByText("Code Interpreter")).toBeVisible();
    expect(screen.getByText("View Image")).toBeVisible();
    expect(screen.getByText("View X Video")).toBeVisible();
  });
});
