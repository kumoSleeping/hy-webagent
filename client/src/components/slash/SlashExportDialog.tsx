import { useState } from "react";
import { Download } from "lucide-react";
import { PanelActions, PanelBody, PanelButton, PanelListRow } from "../common/panel";

interface SlashExportDialogProps {
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
}

const FORMATS = [
  { value: "jsonl", label: "JSONL", detail: "Session export" },
  { value: "html", label: "HTML", detail: "Session export" },
];

export function SlashExportDialog({
  onExecute,
  onClose,
}: SlashExportDialogProps) {
  const [format, setFormat] = useState("jsonl");
  const [outputPath, setOutputPath] = useState("");

  function handleExport() {
    const args: Record<string, unknown> = {};
    if (outputPath.trim()) args.outputPath = outputPath.trim();
    if (format === "html") {
      onExecute("session.exportHtml", args);
    } else {
      onExecute("session.exportJsonl", args);
    }
  }

  return (
    <PanelBody
      variant="form"
      footer={
        <PanelActions>
          <PanelButton variant="ghost" onClick={onClose}>
            Cancel
          </PanelButton>
          <PanelButton variant="primary" onClick={handleExport}>
            <Download size={12} aria-hidden="true" />
            Export
          </PanelButton>
        </PanelActions>
      }
    >
      {FORMATS.map((item, index) => (
        <PanelListRow
          key={item.value}
          leading={String(index + 1).padStart(2, "0")}
          leadingKind="index"
          title={item.label}
          detail={item.detail}
          selected={format === item.value}
          onClick={() => setFormat(item.value)}
        />
      ))}
      <label className="pi-panel-field">
        <span className="pi-panel-field-label">Output path</span>
        <input
          type="text"
          value={outputPath}
          onChange={(e) => setOutputPath(e.target.value)}
          placeholder={`session_export.${format}`}
          className="pi-panel-input"
        />
      </label>
    </PanelBody>
  );
}
