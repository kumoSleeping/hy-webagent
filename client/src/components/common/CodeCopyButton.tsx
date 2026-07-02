import { useState, type MouseEvent } from "react";
import { copyTextToClipboard } from "../../lib/copyToClipboard";

interface CodeCopyButtonProps {
  getText: () => string;
}

export function CodeCopyButton({ getText }: CodeCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyTextToClipboard(getText());
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      className="pi-code-copy"
      onMouseDown={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
