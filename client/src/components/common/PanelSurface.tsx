import { type ReactNode, type HTMLAttributes } from "react";

interface PanelSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "card" | "message-user" | "message-assistant";
  children: ReactNode;
}

const variants: Record<string, string> = {
  card: "pi-panel-card",
  "message-user": "pi-message-dialog pi-message-dialog-user",
  "message-assistant": "pi-message-dialog pi-message-dialog-assistant",
};

/** Flat white surface — hairline border + soft shadow (design: no glass). */
export function PanelSurface({ variant = "card", className = "", children, ...props }: PanelSurfaceProps) {
  return <div className={`${variants[variant] || variants.card} ${className}`} {...props}>{children}</div>;
}
