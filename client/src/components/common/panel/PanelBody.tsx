import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type PanelBodyVariant = "list" | "form";

interface PanelBodyProps {
  /** list = scrollable rows; form = padded fields + optional footer */
  variant?: PanelBodyVariant;
  filter?: ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Shared body for both small (composer) and large (center-stage) panels. */
export function PanelBody({
  variant = "list",
  filter,
  loading = false,
  empty,
  footer,
  children,
  className = "",
}: PanelBodyProps) {
  const showEmpty = !loading && empty != null;

  return (
    <div className={`pi-panel-body pi-panel-body--${variant}${className ? ` ${className}` : ""}`}>
      {filter ? <div className="pi-panel-body-filter">{filter}</div> : null}
      <div className="pi-panel-body-scroll pi-scrollbar">
        {loading ? (
          <div className="pi-panel-loading" role="status" aria-label="Loading">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          </div>
        ) : showEmpty ? (
          <div className="pi-panel-empty">{empty}</div>
        ) : (
          children
        )}
      </div>
      {footer ? <div className="pi-panel-footer">{footer}</div> : null}
    </div>
  );
}
