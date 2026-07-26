import { useEffect, useState } from "react";
import { MarkdownContent } from "./MarkdownContent";
import { PanelSurface } from "../common/PanelSurface";

declare global {
  interface Window {
    __PI_RENDER_MESSAGE__?: (payload: { markdown: string; themeColor?: string; renderId: string }) => void;
  }
}

export function MessageRenderPage() {
  const [render, setRender] = useState({ markdown: "", renderId: "" });

  useEffect(() => {
    window.__PI_RENDER_MESSAGE__ = ({ markdown, themeColor, renderId }) => {
      if (themeColor) document.documentElement.style.setProperty("--pi-theme", themeColor);
      setRender({ markdown, renderId });
    };
    document.documentElement.dataset.piRenderReady = "true";
    return () => {
      delete window.__PI_RENDER_MESSAGE__;
      delete document.documentElement.dataset.piRenderReady;
    };
  }, []);

  return (
    <main className="pi-message-render-page">
      <PanelSurface variant="message-assistant" className="pi-message-render-card" data-render-id={render.renderId}>
        <MarkdownContent>{render.markdown}</MarkdownContent>
      </PanelSurface>
    </main>
  );
}
