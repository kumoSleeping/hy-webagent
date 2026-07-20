import type { MouseEvent } from "react";
import { slashCommandIcon } from "../../lib/slashCommandIcon";
import type { SlashCommand } from "../../stores/slashStore";
import { PanelListRow } from "../common/panel";

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
    <PanelListRow
      leading={slashCommandIcon(command)}
      leadingKind="icon"
      title={command.label}
      detail={command.description}
      selected={selected}
      onClick={onActivate}
      onMouseDown={onMouseDown}
      itemRef={itemRef}
    />
  );
}
