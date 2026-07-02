import { useSessionStore } from "../stores/sessionStore";
import { parseSessionIdFromPath } from "../lib/chatRoutes";
import { useLocation } from "react-router-dom";

export interface ChatBootstrapInput {
  routeReady: boolean;
  isSyncingSession: boolean;
}

/** True while workspace init or session activation is in flight. WS transcript hydration continues in the background. */
export function useChatBootstrapping({
  routeReady,
  isSyncingSession,
}: ChatBootstrapInput): boolean {
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  const urlSessionId = parseSessionIdFromPath(useLocation().pathname) ?? undefined;

  // Store already matches the URL — don't let stale local route state block the shell.
  if (urlSessionId && activePiSessionId === urlSessionId) return false;
  if (!urlSessionId && activePiSessionId) return false;

  if (!routeReady || isSyncingSession) return true;
  if (!activePiSessionId) return true;
  return false;
}
