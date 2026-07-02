import { useBtwStore } from "../stores/btwStore";
import { useComposerPanelStore } from "../stores/composerPanelStore";

/** Optimistic /btw send — show Q + waiting A immediately, then wire up the websocket. */
export function submitBtwQuestion(
  question: string,
  sendBtwAsk: (question: string) => boolean
): void {
  const q = question.trim();
  if (!q) return;
  useComposerPanelStore.getState().openBtwPanel();
  const turnId = useBtwStore.getState().ensureTurn(q);
  if (!sendBtwAsk(q)) {
    useBtwStore.getState().failTurn(turnId, "Not connected — try again in a moment");
  }
}
