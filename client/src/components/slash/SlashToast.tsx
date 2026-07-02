import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

interface SlashToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose: () => void;
}

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: "border-l-[var(--pi-theme)]",
  error: "border-l-[#dc2626]",
  info: "border-l-[var(--pi-text)]",
};

export function SlashToast({
  message,
  type = "info",
  onClose,
}: SlashToastProps) {
  const Icon = ICONS[type];

  return (
    <div className={`pi-glass relative border-l-4 ${STYLES[type]} p-3 pr-8 animate-[pi-pop-in_200ms_ease-out]`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[var(--pi-text)]">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-[var(--pi-text-body)]">
            {message}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 p-0.5 text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer"
        aria-label="Dismiss toast"
      >
        <X size={14} />
      </button>
    </div>
  );
}
