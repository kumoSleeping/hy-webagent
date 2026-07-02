import { type ReactNode, type HTMLAttributes } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "light" | "message-user" | "message-assistant";
  children: ReactNode;
}

const variants: Record<string, string> = {
  default: "pi-glass",
  light: "pi-glass-light",
  "message-user": "pi-message-dialog pi-message-dialog-user",
  "message-assistant": "pi-message-dialog pi-message-dialog-assistant",
};

export function GlassPanel({ variant = "default", className = "", children, ...props }: GlassPanelProps) {
  return <div className={`${variants[variant] || variants.default} ${className}`} {...props}>{children}</div>;
}
