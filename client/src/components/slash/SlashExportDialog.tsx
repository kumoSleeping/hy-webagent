import { useState } from "react";
import { Download } from "lucide-react";

interface SlashExportDialogProps {
  onExecute: (command: string, args: Record<string, unknown>) => void;
  onClose: () => void;
}

const FORMATS = [
  { value: "jsonl", label: "JSONL" },
  { value: "html", label: "HTML" },
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
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto pi-scrollbar p-3 space-y-3">
        <div className="flex gap-1">
            {FORMATS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFormat(item.value)}
                className={`flex-1 h-8 text-[0.72rem] uppercase tracking-wider border transition-colors cursor-pointer outline-none ${
                  format === item.value
                    ? "border-[var(--pi-theme)] bg-[var(--pi-accent-soft)] text-[var(--pi-text)]"
                    : "border-[var(--pi-line)] bg-white text-[var(--pi-text)] hover:border-[var(--pi-theme)]"
                }`}
              >
                {item.label}
              </button>
            ))}
        </div>

        <input
          type="text"
          value={outputPath}
          onChange={(e) => setOutputPath(e.target.value)}
          placeholder={`session_export.${format}`}
          className="w-full border border-[var(--pi-line)] bg-white px-2.5 py-2 text-xs text-[var(--pi-text)] outline-none"
        />
      </div>

      <div className="shrink-0 flex justify-end p-2.5 gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 items-center px-3 text-[0.72rem] uppercase tracking-wider text-[var(--pi-muted)] border border-[var(--pi-line)] bg-white hover:border-[var(--pi-theme)] hover:text-[var(--pi-theme)] cursor-pointer outline-none"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex h-8 items-center gap-1.5 bg-[var(--pi-text)] px-3 text-[0.72rem] uppercase tracking-wider text-white transition-all hover:bg-[#1c1c1e] cursor-pointer outline-none"
        >
          <Download size={12} />
          Export
        </button>
      </div>
    </div>
  );
}
