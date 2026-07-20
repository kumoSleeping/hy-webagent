import type { ButtonHTMLAttributes, ReactNode } from "react";

interface PanelActionsProps {
  children: ReactNode;
}

/** Right-aligned action cluster for panel footers. */
export function PanelActions({ children }: PanelActionsProps) {
  return <div className="pi-panel-actions">{children}</div>;
}

type PanelButtonVariant = "primary" | "ghost";

interface PanelButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PanelButtonVariant;
  children: ReactNode;
}

export function PanelButton({
  variant = "primary",
  className = "",
  children,
  type = "button",
  ...rest
}: PanelButtonProps) {
  return (
    <button
      type={type}
      className={`pi-panel-btn pi-panel-btn--${variant}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
