import type { ReactNode } from "react";
import {
  Command,
  Copy,
  Cpu,
  Download,
  FileText,
  GitBranch,
  GitFork,
  History,
  Info,
  Layers,
  Minimize2,
  PencilLine,
  Puzzle,
  RefreshCw,
  Settings,
  Sparkles,
  SquarePen,
  Upload,
} from "lucide-react";
import type { SlashCommand } from "../stores/slashStore";

export function slashCommandIcon(command: SlashCommand): ReactNode {
  switch (command.id) {
    case "model":
      return <Cpu strokeWidth={2} aria-hidden="true" />;
    case "scoped-models":
      return <Layers strokeWidth={2} aria-hidden="true" />;
    case "settings":
      return <Settings strokeWidth={2} aria-hidden="true" />;
    case "new":
      return <SquarePen strokeWidth={2} aria-hidden="true" />;
    case "resume":
      return <History strokeWidth={2} aria-hidden="true" />;
    case "fork":
      return <GitFork strokeWidth={2} aria-hidden="true" />;
    case "tree":
      return <GitBranch strokeWidth={2} aria-hidden="true" />;
    case "compact":
      return <Minimize2 strokeWidth={2} aria-hidden="true" />;
    case "name":
      return <PencilLine strokeWidth={2} aria-hidden="true" />;
    case "session":
      return <Info strokeWidth={2} aria-hidden="true" />;
    case "copy":
      return <Copy strokeWidth={2} aria-hidden="true" />;
    case "export":
      return <Download strokeWidth={2} aria-hidden="true" />;
    case "import":
      return <Upload strokeWidth={2} aria-hidden="true" />;
    case "reload":
      return <RefreshCw strokeWidth={2} aria-hidden="true" />;
    default:
      switch (command.kind) {
        case "prompt":
          return <FileText strokeWidth={2} aria-hidden="true" />;
        case "skill":
          return <Sparkles strokeWidth={2} aria-hidden="true" />;
        case "extension":
          return <Puzzle strokeWidth={2} aria-hidden="true" />;
        default:
          return <Command strokeWidth={2} aria-hidden="true" />;
      }
  }
}
