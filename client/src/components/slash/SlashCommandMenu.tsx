import type { SlashCommand } from "../../stores/slashStore";
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
    <div className="pi-glass absolute left-0 right-0 bottom-full mb-2 max-h-64 overflow-auto pi-scrollbar z-50">
      {commands.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--pi-muted)]">No matching commands</div>
      ) : (
        commands.map((cmd, index) => (
          <SlashCommandListItem
            key={cmd.id}
            command={cmd}
            systemCommands={systemCommands}
            selected={index === selectedIndex}
            onActivate={() => onExecute(cmd)}
          />
        ))
      )}
    </div>
  );
}
