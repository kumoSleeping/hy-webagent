import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageRenderPage } from "./MessageRenderPage";

describe("MessageRenderPage", () => {
  it("reuses the Summary card including its icon", () => {
    const { container, getByText } = render(<MessageRenderPage />);

    act(() => {
      window.__PI_RENDER_MESSAGE__?.({
        markdown: "```summary\nRendered summary\n```",
        themeColor: "#ef4444",
        renderId: "render-test",
      });
    });

    const badge = getByText("Summary").closest(".pi-corner-badge");
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(getByText("Rendered summary")).toHaveClass("pi-md-summary-body");
    expect(container.querySelector(".pi-message-render-card")).toHaveAttribute(
      "data-render-id",
      "render-test",
    );
  });
});
