import { Search, X } from "lucide-react";

interface PanelFilterBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** Toolbar-panel search row — 16px input so iOS Safari does not zoom on focus. */
export function PanelFilterBar({ value, onChange, placeholder }: PanelFilterBarProps) {
  return (
    <div className="pi-panel-filter">
      <Search className="shrink-0 text-[var(--pi-muted)]" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pi-panel-filter-input"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer outline-none"
          aria-label="Clear filter"
        >
          <X />
        </button>
      )}
    </div>
  );
}
