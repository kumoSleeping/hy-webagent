import { fireEvent, render } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StableComposerEditor, type ComposerEditorHandle } from "./StableComposerEditor";

function Harness() {
  const [, setMirror] = useState("");
  const [status, setStatus] = useState("idle");
  return (
    <>
      <StableComposerEditor
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

describe("StableComposerEditor", () => {
  it("supports plain-text selection replacement without textarea APIs", () => {
    const editorRef = createRef<ComposerEditorHandle>();
    render(
      <StableComposerEditor
        ref={editorRef}
        aria-label="selection-composer"
        initialValue="abcd"
        onValueChange={() => {}}
      />,
    );

    editorRef.current!.focus();
    editorRef.current!.setSelectionRange(1, 3);
    expect(editorRef.current!.selectionStart).toBe(1);
    expect(editorRef.current!.selectionEnd).toBe(3);
    editorRef.current!.insertText("X");
    expect(editorRef.current!.value).toBe("aXd");
  });

  it("renders a pasted-text marker as an atomic colored token", () => {
    const editorRef = createRef<ComposerEditorHandle>();
    const marker = "[Pasted text · 400chars]";
    const { getByLabelText } = render(
      <StableComposerEditor
        ref={editorRef}
        aria-label="token-composer"
        initialValue={marker}
        onValueChange={() => {}}
      />,
    );

    const editor = getByLabelText("token-composer");
    expect(editor.querySelector(".pi-composer-text-token")).toHaveTextContent(marker);
    expect(editorRef.current!.value).toBe(marker);
    editorRef.current!.focus();
    editorRef.current!.setSelectionRange(marker.length, marker.length);
    expect(editorRef.current!.selectionStart).toBe(marker.length);
  });

  it("preserves browser text and caret across unrelated React rerenders", () => {
    const { getByLabelText, getByRole } = render(<Harness />);
    const editor = getByLabelText("composer") as HTMLDivElement;

    editor.focus();
    editor.textContent = "你好世界";
    fireEvent.input(editor, { inputType: "insertText" });
    const range = document.createRange();
    range.setStart(editor.firstChild!, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(getByRole("button", { name: "rerender" }));

    expect(editor.textContent).toBe("你好世界");
    expect(window.getSelection()?.anchorOffset).toBe(2);
    expect(document.activeElement).toBe(editor);
  });

  it("does not rerender the owner during an active IME composition", () => {
    const onValueChange = vi.fn();
    const onCompositionEnd = vi.fn();
    const { getByLabelText } = render(
      <StableComposerEditor
        aria-label="ime-composer"
        initialValue=""
        onValueChange={onValueChange}
        onCompositionEnd={onCompositionEnd}
      />,
    );
    const editor = getByLabelText("ime-composer") as HTMLDivElement;

    fireEvent.compositionStart(editor);
    editor.textContent = "你";
    fireEvent.input(editor, { inputType: "insertCompositionText" });
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(editor, { data: "你" });
    expect(onCompositionEnd).toHaveBeenCalledOnce();
    expect(editor.textContent).toBe("你");
  });
});
