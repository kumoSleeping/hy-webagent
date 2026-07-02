import type { EditorViewMode } from "../types";

export function isMarkdownFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

export function defaultViewModeForFile(filename: string): EditorViewMode {
  return isMarkdownFile(filename) ? "preview" : "edit";
}
