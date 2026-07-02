import { useRef } from "react";
import { CodeCopyButton } from "../common/CodeCopyButton";

interface CodeBlockProps {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null);

  return (
    <div className="pi-code-block">
      <div className="pi-code-block-bar">
        <span className="pi-code-lang">{language || "text"}</span>
        <CodeCopyButton getText={() => preRef.current?.textContent ?? code} />
      </div>
      <pre ref={preRef}><code>{code}</code></pre>
    </div>
  );
}
