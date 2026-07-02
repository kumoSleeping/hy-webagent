import type { SlashCommand } from "../../stores/slashStore";
import { commandKindLabel, commandOriginLabel } from "../../lib/slashCommandMeta";

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
        commands.map((cmd, index) => {
          const origin = commandOriginLabel(cmd, systemCommands);
          return (
            <button
              key={cmd.id}
              type="button"
              onClick={() => onExecute(cmd)}
              className={`pi-panel-row w-full flex items-center px-3 py-2 text-left transition-colors cursor-pointer outline-none border-none bg-transparent${
                index === selectedIndex ? " pi-panel-row--selected" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="pi-composer-cmd-name">/{cmd.label}</span>
                  <span className="pi-composer-cmd-meta">
                    {commandKindLabel(cmd.kind)}
                  </span>
                  {origin !== cmd.kind && (
                    <span className="pi-composer-cmd-meta pi-composer-cmd-meta--accent">
                      {origin}
                    </span>
                  )}
                </div>
                <p className="pi-composer-cmd-desc">{cmd.description}</p>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
