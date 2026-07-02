import { useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { EditorTab } from "../../types";

interface MonacoEditorProps {
  tab: EditorTab;
  onChange?: (content: string) => void;
  onFocus?: () => void;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", json: "json", md: "markdown", html: "html", css: "css",
  sh: "shell", bash: "shell", yaml: "yaml", yml: "yaml", xml: "xml",
  sql: "sql", rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp",
  h: "c", hpp: "cpp",
};

function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "plaintext";
}

let piEditorThemeReady = false;

/** Syntax + chrome palette aligned with `.pi-markdown .hljs` and design tokens. */
function ensurePiEditorTheme(monaco: Parameters<OnMount>[1]) {
  if (piEditorThemeReady) return;
  monaco.editor.defineTheme("pi-editor", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "3a3a3c" },
      { token: "comment", foreground: "86868b", fontStyle: "italic" },
      { token: "comment.line", foreground: "86868b", fontStyle: "italic" },
      { token: "comment.block", foreground: "86868b", fontStyle: "italic" },
      { token: "keyword", foreground: "7c3aed", fontStyle: "bold" },
      { token: "keyword.control", foreground: "7c3aed" },
      { token: "keyword.operator", foreground: "86868b" },
      { token: "string", foreground: "059669" },
      { token: "string.escape", foreground: "d97706" },
      { token: "number", foreground: "d97706" },
      { token: "number.hex", foreground: "d97706" },
      { token: "type", foreground: "0891b2" },
      { token: "type.identifier", foreground: "0891b2" },
      { token: "class", foreground: "0891b2" },
      { token: "interface", foreground: "0891b2" },
      { token: "function", foreground: "2563eb" },
      { token: "function.declaration", foreground: "2563eb", fontStyle: "bold" },
      { token: "method", foreground: "2563eb" },
      { token: "support.function", foreground: "2563eb" },
      { token: "variable", foreground: "dc2626" },
      { token: "variable.parameter", foreground: "3a3a3c" },
      { token: "variable.language", foreground: "7c3aed" },
      { token: "identifier", foreground: "3a3a3c" },
      { token: "tag", foreground: "ef4444" },
      { token: "tag.id", foreground: "ef4444" },
      { token: "tag.class", foreground: "ef4444" },
      { token: "attribute.name", foreground: "0891b2" },
      { token: "attribute.value", foreground: "059669" },
      /* Markdown — headings stay editorial neutral, not default VS blue */
      { token: "markup.heading", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "markup.heading.markdown", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "header", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "header.markdown", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "keyword.md", foreground: "86868b" },
      { token: "markup.bold", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "markup.bold.markdown", foreground: "2c2c2e", fontStyle: "bold" },
      { token: "markup.italic", foreground: "3a3a3c", fontStyle: "italic" },
      { token: "markup.italic.markdown", foreground: "3a3a3c", fontStyle: "italic" },
      { token: "markup.list", foreground: "86868b" },
      { token: "markup.list.markdown", foreground: "86868b" },
      { token: "string.link", foreground: "2563eb" },
      { token: "string.other.link.title.markdown", foreground: "2563eb" },
      { token: "markup.inline.raw", foreground: "059669" },
      { token: "markup.inline.raw.markdown", foreground: "059669" },
      { token: "markup.fenced_code.block.markdown", foreground: "059669" },
      { token: "string.key.json", foreground: "dc2626" },
      { token: "string.value.json", foreground: "059669" },
      { token: "delimiter", foreground: "86868b" },
      { token: "delimiter.bracket", foreground: "86868b" },
      { token: "delimiter.parenthesis", foreground: "86868b" },
      { token: "regexp", foreground: "d97706" },
      { token: "constant", foreground: "d97706" },
      { token: "constant.language", foreground: "7c3aed" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#3a3a3c",
      "editorLineNumber.foreground": "#86868b",
      "editorLineNumber.activeForeground": "#2c2c2e",
      "editorCursor.foreground": "#ef4444",
      "editor.selectionBackground": "#ef444424",
      "editor.inactiveSelectionBackground": "#ef444414",
      "editor.selectionHighlightBackground": "#ef444418",
      "editor.wordHighlightBackground": "#ef444420",
      "editor.wordHighlightStrongBackground": "#ef444428",
      "editor.findMatchBackground": "#ef444430",
      "editor.findMatchHighlightBackground": "#ef444418",
      "editor.hoverHighlightBackground": "#ef444414",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background": "#f2f2f2",
      "editorIndentGuide.activeBackground": "#e5e7eb",
      "editorBracketMatch.background": "#ef444418",
      "editorBracketMatch.border": "#ef4444",
      "editorGutter.background": "#ffffff",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e5e7eb",
      "editorOverviewRuler.border": "#00000000",
      "scrollbarSlider.background": "#3c3c4324",
      "scrollbarSlider.hoverBackground": "#3c3c4338",
      "scrollbarSlider.activeBackground": "#3c3c4348",
    },
  });
  piEditorThemeReady = true;
}

export function MonacoEditor({ tab, onChange, onFocus }: MonacoEditorProps) {
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  const handleMount: OnMount = (editor, monaco) => {
    ensurePiEditorTheme(monaco);
    monaco.editor.setTheme("pi-editor");
    editor.onDidFocusEditorText(() => onFocusRef.current?.());
  };

  return (
    <Editor
      height="100%"
      language={getLanguage(tab.name)}
      value={tab.content}
      theme="pi-editor"
      onChange={(value) => onChange?.(value || "")}
      onMount={handleMount}
      options={{
        fontSize: 16,
        lineHeight: 24,
        fontFamily: "'SF Mono', 'JetBrains Mono', 'Menlo', monospace",
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderLineHighlight: "none",
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        bracketPairColorization: { enabled: false },
        guides: { indentation: true, highlightActiveIndentation: true },
        automaticLayout: true,
        padding: { top: 8, bottom: 8 },
        unicodeHighlight: {
          ambiguousCharacters: false,
          invisibleCharacters: false,
          nonBasicASCII: false,
        },
      }}
    />
  );
}
