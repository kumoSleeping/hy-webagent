import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import { apiPost, setSessionId } from "../lib/api";
import { chatPath, parseSessionIdFromPath, isNewChatPath } from "../lib/chatRoutes";
import { bindSessionNavigation, unbindSessionNavigation } from "../lib/sessionNavigation";
import { fetchSessionStatus } from "./useStatusBarSync";

/**
 * Binds router navigation to the session store and restores sessions from
 * the URL on load / browser back-forward.
 */
export function useChatSessionRoute() {
  const location = useLocation();
  // Read from the pathname, not useParams — this hook runs while LoadingGate
  // hides <Routes>, so react-router has no matched route and useParams() is
  // empty on refresh even though the URL is still /chat/:sessionId.
  const urlSessionId = parseSessionIdFromPath(location.pathname) ?? undefined;
  const navigate = useNavigate();
  const authSessionId = useAuthStore((s) => s.sessionId);
  const [ready, setReady] = useState(false);
  const [isSyncingSession, setIsSyncingSession] = useState(false);
  const defaultRedirectStartedRef = useRef(false);
  const syncingFromUrlRef = useRef(false);
  /** Guards against parallel /chat/new session creation (rapid clicks). */
  const newChatInFlightRef = useRef(false);
  /** Last URL session id we successfully applied to the store (per tab lifetime). */
  const syncedUrlIdRef = useRef<string | null>(null);
  const urlSyncGenerationRef = useRef(0);
  /** Router pathname — never read window.location (MemoryRouter / tests diverge). */
  const latestPathnameRef = useRef(location.pathname);
  latestPathnameRef.current = location.pathname;

  // Bind synchronously so createSession/activateSession can navigate immediately.
  bindSessionNavigation((path, options) => navigate(path, options));
  useEffect(() => () => unbindSessionNavigation(), []);

  // Workspace init — runs once per login. Guest mode skips entirely.
  useEffect(() => {
    const isGuestView = useAuthStore.getState().userId === "__guest__";

    if (!authSessionId && !isGuestView) {
      setReady(false);
      defaultRedirectStartedRef.current = false;
      syncedUrlIdRef.current = null;
      return;
    }

    // Guest mode: skip workspace init, mark ready immediately
    if (isGuestView) {
      setReady(true);
      return;
    }

    // StrictMode remount: a prior mount may have already activated the URL session
    // in zustand while this instance's `ready` was reset to false in cleanup.
    const urlId = parseSessionIdFromPath(latestPathnameRef.current) ?? undefined;
    if (urlId && useSessionStore.getState().activePiSessionId === urlId) {
      syncedUrlIdRef.current = urlId;
      setIsSyncingSession(false);
      setReady(true);
    }

    let cancelled = false;

    (async () => {
      setSessionId(authSessionId);
      try {
        const res = await fetch("/api/workspace/init", {
          method: "POST",
          headers: { Authorization: `Bearer ${authSessionId}` },
        });
        if (!res.ok) throw new Error(`init ${res.status}`);

        void useSessionStore.getState().fetchSessions();
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      setReady(false);
      defaultRedirectStartedRef.current = false;
      syncedUrlIdRef.current = null;
    };
  }, [authSessionId]);

  // `/` → navigate to /chat/new which creates a fresh session.
  // This keeps the bookmark URL generic (no specific session id).
  useEffect(() => {
    const isGuestView = useAuthStore.getState().userId === "__guest__";
    if (!ready || urlSessionId || defaultRedirectStartedRef.current || isGuestView) return;
    defaultRedirectStartedRef.current = true;
    setIsSyncingSession(true);
    navigate(chatPath("new"), { replace: true });
    setIsSyncingSession(false);
  }, [ready, urlSessionId, navigate]);

  // `/chat/new` → create a fresh session, then redirect to /chat/:id.
  useEffect(() => {
    if (!ready) return;
    if (!isNewChatPath(latestPathnameRef.current)) return;
    if (newChatInFlightRef.current) return;
    newChatInFlightRef.current = true;
    setIsSyncingSession(true);

    void (async () => {
      try {
        const id = await useSessionStore.getState().createSession({ syncUrl: false });
        void useSessionStore.getState().fetchSessions();
        if (!id || !isNewChatPath(latestPathnameRef.current)) return;
        syncedUrlIdRef.current = id;
        navigate(chatPath(id), { replace: true });
      } catch (err) {
        console.error(err);
        // Fall back to / on error
        if (isNewChatPath(latestPathnameRef.current)) {
          navigate("/", { replace: true });
        }
      } finally {
        setIsSyncingSession(false);
        newChatInFlightRef.current = false;
      }
    })();
  }, [ready, navigate]);

  // URL changed (refresh, direct link, browser back/forward) → activate session.
  useEffect(() => {
    if (!ready || !urlSessionId) return;

    const current = useSessionStore.getState().activePiSessionId;
    const hydrated = useChatStore.getState().hydratedPiSessionId;

    // Bind store + WS immediately from the URL — don't wait for HTTP activate.
    if (current !== urlSessionId) {
      useSessionStore.getState().setActiveSession(urlSessionId, { syncUrl: false });
    }

    if (urlSessionId === useSessionStore.getState().activePiSessionId) {
      syncedUrlIdRef.current = urlSessionId;
    }
    if (syncedUrlIdRef.current === urlSessionId && hydrated === urlSessionId) {
      setIsSyncingSession(false);
      return;
    }

    const generation = ++urlSyncGenerationRef.current;
    let cancelled = false;
    syncingFromUrlRef.current = true;
    setIsSyncingSession(true);

    void (async () => {
      try {
        const data = await apiPost<{ sessionId: string }>(`/api/sessions/${urlSessionId}/activate`);
        if (
          cancelled
          || generation !== urlSyncGenerationRef.current
          || parseSessionIdFromPath(latestPathnameRef.current) !== urlSessionId
        ) {
          return;
        }

        const resolvedId = data.sessionId;
        useSessionStore.getState().setActiveSession(resolvedId, { syncUrl: false });
        void useSessionStore.getState().fetchSessions();
        void fetchSessionStatus(resolvedId).catch((err) =>
          console.warn("status bar restore failed:", err)
        );

        syncedUrlIdRef.current = resolvedId;
      } catch (err) {
        console.error(err);
        if (cancelled || generation !== urlSyncGenerationRef.current) return;

        syncedUrlIdRef.current = null;
        // Deleted or unknown session in the URL — create a fresh chat and replace the route.
        const fallbackId = await useSessionStore.getState().createSession({ syncUrl: false });
        void useSessionStore.getState().fetchSessions();
        if (cancelled || generation !== urlSyncGenerationRef.current) return;
        if (!fallbackId) {
          navigate("/", { replace: true });
          return;
        }
        syncedUrlIdRef.current = fallbackId;
        navigate(chatPath(fallbackId), { replace: true });
      } finally {
        if (generation === urlSyncGenerationRef.current) {
          syncingFromUrlRef.current = false;
          setIsSyncingSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (generation === urlSyncGenerationRef.current) {
        syncingFromUrlRef.current = false;
        setIsSyncingSession(false);
      }
    };
  }, [urlSessionId, ready, navigate]);

  return { routeReady: ready, isSyncingSession, syncingFromUrl: syncingFromUrlRef };
}
