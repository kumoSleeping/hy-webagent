import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { StableComposerTextarea } from "./StableComposerTextarea";

function Harness() {
  const [, setMirror] = useState("");
  const [status, setStatus] = useState("idle");
  return (
    <>
      <StableComposerTextarea
        aria-label="composer"
        initialValue=""
        onValueChange={(value) => {
          setMirror(value);
          setStatus(value.length > 2 ? "busy" : "idle");
        }}
        data-status={status}
      />
      <button type="button" onClick={() => setStatus("rerendered")}>rerender</button>
    </>
  );
}

describe("StableComposerTextarea", () => {
  it("preserves browser text and caret across unrelated React rerenders", () => {
    const { getByLabelText, getByRole } = render(<Harness />);
    const textarea = getByLabelText("composer") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.input(textarea, { target: { value: "你好世界" }, inputType: null });
    textarea.setSelectionRange(2, 2);
    fireEvent.click(getByRole("button", { name: "rerender" }));

    expect(textarea.value).toBe("你好世界");
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
    expect(document.activeElement).toBe(textarea);
  });
});
