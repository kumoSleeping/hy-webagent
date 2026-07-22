import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProcessTrace } from "./ProcessTrace";

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
});
