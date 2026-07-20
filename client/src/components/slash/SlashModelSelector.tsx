import { useMemo } from "react";
import { Cpu } from "lucide-react";
import { useKeyboardListNav } from "../../hooks/useKeyboardListNav";
import { PanelBody, PanelListRow } from "../common/panel";

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
    <PanelBody
      variant="list"
      empty={models.length === 0 ? "No models available" : undefined}
    >
      {models.map((model, index) => {
        const { isActive } = getHighlight(index);
        const mouse = getMouseHandlers(index);
        const current = isCurrentModel(model, currentModel);
        return (
          <PanelListRow
            key={`${model.provider ?? "default"}/${model.id}`}
            itemRef={(el) => setItemRef(index, el)}
            leading={<Cpu size={14} strokeWidth={2} />}
            leadingKind="icon"
            title={model.name ?? model.id}
            detail={`${model.provider ?? "default"} / ${model.id}`}
            stacked
            selected={isActive || current}
            onClick={() =>
              onExecute("model.set", { provider: model.provider || "anthropic", modelId: model.id })
            }
            onMouseEnter={mouse.onMouseEnter}
            onMouseLeave={mouse.onMouseLeave}
          />
        );
      })}
    </PanelBody>
  );
}
