import type { Request, Response } from "express";
import { BrowserMessageRenderer } from "../render/browser-message-renderer.js";
import { createLogger } from "../logger.js";

const log = createLogger("message-render-route");

interface RenderBody {
  markdown?: unknown;
  theme_color?: unknown;
  sections?: { process?: unknown; final?: unknown };
}

function resolveContent(body: RenderBody, filter: string): string {
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  const process = typeof body.sections?.process === "string" ? body.sections.process : "";
  const final = typeof body.sections?.final === "string" ? body.sections.final : "";
  if (!body.sections) return markdown;
  if (filter === "process") return process;
  if (filter === "final") return final || markdown;
  return [process, final].filter(Boolean).join("\n\n---\n\n") || markdown;
}

export function createMessageRenderHandler(renderer: BrowserMessageRenderer, base64: boolean) {
  return async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as RenderBody;
      const filter = ["all", "process", "final"].includes(String(req.query.filter))
        ? String(req.query.filter)
        : "all";
      const markdown = resolveContent(body, filter);
      if (!markdown.trim()) {
        res.status(400).json({ error: "empty content" });
        return;
      }
      const themeColor = typeof body.theme_color === "string" && /^#[0-9a-f]{6}$/i.test(body.theme_color)
        ? body.theme_color
        : "#ef4444";
      const jpeg = await renderer.render(markdown, themeColor);
      res.set("X-Render-Filter", filter);
      if (base64) {
        const encoded = jpeg.toString("base64");
        res.json({
          data: `data:image/jpeg;base64,${encoded}`,
          base64: encoded,
          mime_type: "image/jpeg",
          filter,
        });
      } else {
        res.type("image/jpeg").send(jpeg);
      }
    } catch (error) {
      log.error(`browser render failed: ${(error as Error).message}`);
      res.status(500).json({ error: "Render failed", detail: (error as Error).message });
    }
  };
}
