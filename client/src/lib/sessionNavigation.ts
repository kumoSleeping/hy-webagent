import { chatPath } from "./chatRoutes";

type NavigateFn = (path: string, options?: { replace?: boolean }) => void;

let navigateFn: NavigateFn | null = null;

/** Register react-router navigate — called once from useChatSessionRoute. */
export function bindSessionNavigation(navigate: NavigateFn) {
  navigateFn = navigate;
}

export function unbindSessionNavigation() {
  navigateFn = null;
}

/** Push/replace the browser URL to match a Pi session id. */
export function navigateToSession(sessionId: string, options?: { replace?: boolean }) {
  navigateFn?.(chatPath(sessionId), options);
}
