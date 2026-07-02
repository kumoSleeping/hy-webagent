import { useState } from "react";
import { Cpu, Check, X } from "lucide-react";

interface SlashModel {
  id: string;
  label?: string;
  provider?: string;
}

interface SlashScopedModelsProps {
  models: SlashModel[];
  scopedModels: string[];
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
}

export function SlashScopedModels({
  models,
  scopedModels,
  onExecute,
  onClose,
}: SlashScopedModelsProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(scopedModels);

  function toggleModel(modelId: string) {
    setSelectedIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  }

  function handleSave() {
    onExecute("model.setScoped", { models: selectedIds });
  }

  return (
    <div className="pi-glass relative p-5 pt-10">
      <div className="pi-corner-badge">
        <Cpu size={14} />
        Scoped
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg uppercase tracking-tight text-[var(--pi-text)]">
          Scoped Models
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[var(--pi-muted)] hover:text-[var(--pi-theme)] cursor-pointer"
          aria-label="Close scoped models panel"
        >
          <X size={16} />
        </button>
      </div>
      <p className="mb-3 text-xs text-[var(--pi-muted)]">
        Choose models available for cycling in this session.
      </p>
      <div className="max-h-64 overflow-auto pi-scrollbar space-y-1">
        {models.length === 0 ? (
          <p className="px-2 py-3 text-xs text-[var(--pi-muted)] font-mono">No models available</p>
        ) : (
          models.map((model) => {
            const isSelected = selectedIds.includes(model.id);
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggleModel(model.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left border transition-colors cursor-pointer ${
                  isSelected
                    ? "border-[var(--pi-theme)] bg-[var(--pi-accent-soft)]"
                    : "border-transparent bg-[var(--pi-panel-subtle)] hover:border-[var(--pi-line)]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-base text-[var(--pi-text)]">
                    {model.label ?? model.id}
                  </div>
                  <div className="pi-composer-panel-item-meta">
                    {model.provider ?? "default"}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--pi-line)] pt-3">
        <span className="text-sm uppercase tracking-wider text-[var(--pi-muted)]">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          onClick={handleSave}
          className="flex h-9 items-center gap-2 bg-[var(--pi-text)] px-4 text-xs uppercase tracking-wider text-white transition-all hover:bg-[#1c1c1e] cursor-pointer"
        >
          <Check size={14} />
          Save
        </button>
      </div>
    </div>
  );
}
