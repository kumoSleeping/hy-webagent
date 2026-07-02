import { useMemo } from "react";
import { useKeyboardListNav } from "../../hooks/useKeyboardListNav";

export interface SlashModel {
  id: string;
  name?: string;
  provider?: string;
}

interface SlashModelSelectorProps {
  models: SlashModel[];
  currentModel?: string;
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
}

function isCurrentModel(model: SlashModel, currentModel?: string): boolean {
  if (!currentModel) return false;
  const modelKey = `${model.provider ?? "default"}/${model.id}`;
  return modelKey === currentModel || model.id === currentModel;
}

function indexOfCurrentModel(models: SlashModel[], currentModel?: string): number {
  if (!currentModel || models.length === 0) return 0;
  const idx = models.findIndex((model) => isCurrentModel(model, currentModel));
  return idx >= 0 ? idx : 0;
}

export function SlashModelSelector({
  models,
  currentModel,
  onExecute,
  onClose,
}: SlashModelSelectorProps) {
  const initialIndex = useMemo(
    () => indexOfCurrentModel(models, currentModel),
    [models, currentModel],
  );

  const { setItemRef, getHighlight, getMouseHandlers } = useKeyboardListNav({
    items: models,
    initialIndex,
    onSelect: (model) => {
      onExecute("model.set", { provider: model.provider || "anthropic", modelId: model.id });
    },
    onEscape: onClose,
  });

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="pi-composer-panel-body pi-scrollbar space-y-0.5">
        {models.map((model, index) => {
          const { isActive } = getHighlight(index);
          const mouse = getMouseHandlers(index);
          return (
            <button
              key={model.id}
              ref={(el) => setItemRef(index, el)}
              type="button"
              onClick={() =>
                onExecute("model.set", { provider: model.provider || "anthropic", modelId: model.id })
              }
              onMouseEnter={mouse.onMouseEnter}
              onMouseLeave={mouse.onMouseLeave}
              className={`pi-panel-row pi-composer-panel-item border-none bg-transparent${
                isActive ? " pi-panel-row--selected" : ""
              }`}
            >
              <div className="pi-composer-panel-item-name">
                {model.name ?? model.id}
              </div>
              <div className="pi-composer-panel-item-meta">
                {model.provider ?? "default"} / {model.id}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
