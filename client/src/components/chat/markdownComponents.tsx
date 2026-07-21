import { isValidElement, useRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { downloadAuthenticatedFile } from "../../lib/api";
import { CodeCopyButton } from "../common/CodeCopyButton";

function isFileDownloadHref(href?: string): boolean {
  if (!href) return false;
  try {
    const pathname = href.startsWith("http")
      ? new URL(href).pathname
      : new URL(href, "http://local").pathname;
    return pathname === "/api/files/download";
  } catch {
    return false;
  }
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function CornerBadge({ label }: { label: string }) {
  return <div className="pi-corner-badge">{label}</div>;
}

function SummaryCard({ children }: { children?: ReactNode }) {
  const text = extractText(children).trim();
  return (
    <div className="pi-md-card pi-md-card--summary">
      <CornerBadge label="Summary" />
      <div className="pi-md-summary-body">{text}</div>
    </div>
  );
}

function PreBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  let language = "text";

  if (isValidElement<{ className?: string }>(children)) {
    const cls = children.props.className ?? "";
    const match = /language-([\w-]+)/.exec(cls);
    if (match) language = match[1];
  }

  if (language.toLowerCase() === "summary") {
    return <SummaryCard>{children}</SummaryCard>;
  }

  const label = language && language !== "text"
    ? language.charAt(0).toUpperCase() + language.slice(1)
    : "Code";

  return (
    <div className="pi-md-card pi-md-card--code">
      <CornerBadge label={label} />
      <div className="pi-md-pre">
        <div className="pi-md-pre-bar">
          <span className="pi-md-pre-lang">{language}</span>
          <CodeCopyButton getText={() => preRef.current?.textContent ?? extractText(children)} />
        </div>
        <pre ref={preRef}>{children}</pre>
      </div>
    </div>
  );
}

export const markdownComponents: Components = {
  hr: () => <div className="pi-md-hr" role="separator" />,
  pre: ({ children }) => <PreBlock>{children}</PreBlock>,
  table: ({ children }) => (
    <div className="pi-md-card pi-md-card--table">
      <CornerBadge label="Table" />
      <div className="pi-md-table-wrap">
        <table>{children}</table>
      </div>
    </div>
  ),
  a: ({ href, children }) => {
    if (isFileDownloadHref(href)) {
      return (
        <a
          href={href}
          className="pi-md-download-link"
          onClick={(e) => {
            e.preventDefault();
            void downloadAuthenticatedFile(href!);
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};
