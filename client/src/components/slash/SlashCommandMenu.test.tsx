import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlashCommandMenu } from "./SlashCommandMenu";
import type { SlashCommand } from "../../stores/slashStore";

const commands: SlashCommand[] = [
  { id: "model", label: "Model", description: "Pick a model", kind: "panel" },
  { id: "settings", label: "Settings", description: "Adjust preferences", kind: "panel" },
  { id: "new", label: "New", description: "Start a new session", kind: "instant" },
];

describe("SlashCommandMenu", () => {
  it("renders commands", () => {
    render(
      <SlashCommandMenu
        commands={commands}
        selectedIndex={0}
        onExecute={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("calls onExecute when a command is clicked", () => {
    const onExecute = vi.fn();
    render(
      <SlashCommandMenu
        commands={commands}
        selectedIndex={0}
        onExecute={onExecute}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("New"));
    expect(onExecute).toHaveBeenCalledWith(commands[2]);
  });

  it("renders empty list without crashing", () => {
    render(
      <SlashCommandMenu
        commands={[]}
        selectedIndex={0}
        onExecute={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("No matching commands")).toBeInTheDocument();
  });
});
