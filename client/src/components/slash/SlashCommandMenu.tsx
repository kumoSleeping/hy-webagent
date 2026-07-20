import type { SlashCommand } from "../../stores/slashStore";
import { PanelBody } from "../common/panel";
import { SlashCommandListItem } from "./SlashCommandListItem";

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  systemCommands?: SlashCommand[];
  selectedIndex: number;
  onExecute: (command: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandMenu({
  commands,
  systemCommands = [],
  selectedIndex,
  onExecute,
}: SlashCommandMenuProps) {
  return (
    <div className="pi-glass absolute left-0 right-0 bottom-full mb-2 max-h-64 overflow-hidden z-50">
      <PanelBody
        variant="list"
        empty={commands.length === 0 ? "No matching commands" : undefined}
      >
        {commands.map((cmd, index) => (
          <SlashCommandListItem
            key={cmd.id}
            command={cmd}
            systemCommands={systemCommands}
            selected={index === selectedIndex}
            onActivate={() => onExecute(cmd)}
          />
        ))}
      </PanelBody>
    </div>
  );
}
