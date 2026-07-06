import type { MouseEvent } from "react";
import { slashCommandIcon } from "../../lib/slashCommandIcon";
import type { SlashCommand } from "../../stores/slashStore";

interface SlashCommandListItemProps {
  command: SlashCommand;
  systemCommands?: SlashCommand[];
  selected?: boolean;
  onActivate: () => void;
  itemRef?: (el: HTMLButtonElement | null) => void;
  onMouseDown?: (e: MouseEvent) => void;
}

export function SlashCommandListItem({
  command,
  selected = false,
  onActivate,
  itemRef,
  onMouseDown,
}: SlashCommandListItemProps) {
  return (
    <button
      ref={itemRef}
      type="button"
      onMouseDown={onMouseDown}
      onClick={onActivate}
      className={`pi-panel-row pi-composer-cmd-row w-full flex items-center text-left transition-colors cursor-pointer outline-none border-none bg-transparent${
        selected ? " pi-panel-row--selected" : ""
      }`}
    >
      <span className="pi-composer-cmd-icon" aria-hidden="true">
        {slashCommandIcon(command)}
      </span>
      <span className="pi-composer-cmd-name">{command.label}</span>
      <span className="pi-composer-cmd-desc">{command.description}</span>
    </button>
  );
}
