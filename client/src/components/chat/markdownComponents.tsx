import { isValidElement, useRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { Code2, Table2, TextQuote } from "lucide-react";
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

/** HYW card-ui corner badge — hangs off the white body, not inside it. */
function CornerBadge({
  label,
  icon,
}: {
  label: string;
  icon?: ReactNode;
}) {
  return (
    <div className="pi-corner-badge">
      {icon}
      <span>{label}</span>
    </div>
  );
}

/**
 * Match HYW App.vue card structure:
 *   relative wrap → absolute badge (-top/-left) → white body
 * so the red label sits on the body's corner, not flush in the text.
 */
function FeatureCard({
  kind,
  label,
  icon,
  children,
}: {
  kind: "summary" | "code" | "table";
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`pi-md-feature pi-md-feature--${kind}`}>
      <CornerBadge label={label} icon={icon} />
      <div className="pi-md-feature-body">{children}</div>
    </div>
  );
}

function SummaryCard({ children }: { children?: ReactNode }) {
  const text = extractText(children).trim();
  return (
    <FeatureCard
      kind="summary"
      label="Summary"
      icon={<TextQuote size={14} strokeWidth={2.5} aria-hidden="true" />}
    >
      <div className="pi-md-summary-body">{text}</div>
    </FeatureCard>
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
    <FeatureCard
      kind="code"
      label={label}
      icon={<Code2 size={14} strokeWidth={2.5} aria-hidden="true" />}
    >
      <div className="pi-md-pre">
        <div className="pi-md-pre-bar">
          <span className="pi-md-pre-lang">{language}</span>
          <CodeCopyButton getText={() => preRef.current?.textContent ?? extractText(children)} />
        </div>
        <pre ref={preRef}>{children}</pre>
      </div>
    </FeatureCard>
  );
}

export const markdownComponents: Components = {
  hr: () => <div className="pi-md-hr" role="separator" />,
  pre: ({ children }) => <PreBlock>{children}</PreBlock>,
  table: ({ children }) => (
    <FeatureCard
      kind="table"
      label="Table"
      icon={<Table2 size={14} strokeWidth={2.5} aria-hidden="true" />}
    >
      <div className="pi-md-table-wrap">
        <table>{children}</table>
      </div>
    </FeatureCard>
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
