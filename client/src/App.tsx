import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { hasStoredAuth, useAuthStore } from "./stores/authStore";
import { useSessionStore } from "./stores/sessionStore";
import { parseSessionIdFromPath, parseGroupPath, isNewChatPath } from "./lib/chatRoutes";
import { LoginView } from "./components/login/LoginView";
import { LogoutView } from "./components/logout/LogoutView";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { LoadingGate } from "./components/common/LoadingGate";
import { useChatSessionRoute } from "./hooks/useChatSessionRoute";
import { useChatWebSocket } from "./hooks/useChatWebSocket";
import { ChatWebSocketProvider } from "./context/chatWebSocketContext";
import { useAccountProfileSync } from "./hooks/useAccountProfileSync";
import { setGlobalLoaderActive } from "./lib/globalLoader";

const MessageRenderPage = lazy(() =>
  import("./components/chat/MessageRenderPage").then((module) => ({ default: module.MessageRenderPage }))
);
const GroupPreviewApp = lazy(() =>
  import("./components/bot/GroupPreviewApp").then((module) => ({ default: module.GroupPreviewApp }))
);

/** A direct chat URL only enters guest mode after the server confirms access. */
async function isPublicDirectSession(piSessionId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/public/sessions/${encodeURIComponent(piSessionId)}/access`);
    if (!response.ok) return false;
    const payload = await response.json() as { accessible?: unknown };
    return payload.accessible === true;
  } catch {
    // Fail closed: an unavailable access check must never turn a private URL
    // into a guest connection attempt.
    return false;
  }
}

export default function App() {
  const groupMatch = window.location.pathname.match(/^\/bot_([^/]+)\/channel_([^/]+)\/?$/);
  const directGroupRoute = groupMatch ? null : parseGroupPath(window.location.pathname);
  const isMessageRenderPath = window.location.pathname === "/__render/message";
  // 预览模式（路径 /preview/:piSessionId）
  const isPreviewPath = window.location.pathname.startsWith("/preview/");
  const previewPiSessionId = isPreviewPath
    ? window.location.pathname.slice("/preview/".length).split("?")[0]
    : undefined;

  const searchParams = new URLSearchParams(window.location.search);
  const isGuestView = searchParams.get("view") === "1";
  const guestPiSessionId = searchParams.get("piSessionId") ?? undefined;
  // `/chat/:id` is the normal URL copied from the address bar. Treat it as a
  // public read-only link only after attempting to restore an existing login,
  // so an owner opening their own URL keeps the full authenticated workspace.
  const directSharedSessionId = parseSessionIdFromPath(window.location.pathname);

  useEffect(() => {
    if (groupMatch || directGroupRoute || isMessageRenderPath) {
      document.documentElement.classList.remove("pi-auth-pending");
      setGlobalLoaderActive(false);
      return;
    }
    // 预览模式（路径 /preview/:piSessionId）：优先级高于 query 参数访客模式
    if (isPreviewPath && previewPiSessionId) {
      useAuthStore.getState().setGuestMode(previewPiSessionId, true);
      useSessionStore.getState().setActiveSession(previewPiSessionId, { syncUrl: false });
      return;
    }
    // 访客只读模式：跳过登录
    if (isGuestView && guestPiSessionId) {
      useAuthStore.getState().setGuestMode(guestPiSessionId);
      useSessionStore.getState().setActiveSession(guestPiSessionId, { syncUrl: false });
      return;
    }
    if (directSharedSessionId) {
      const enterReadOnlyGuestMode = () => {
        useAuthStore.getState().setGuestMode(directSharedSessionId, true);
        useSessionStore.getState().setActiveSession(directSharedSessionId, { syncUrl: false });
      };

      // A browser with no saved credentials enters guest mode only for a
      // session whose owner explicitly enabled public access. Otherwise leave
      // the normal login screen in place without opening a guest WebSocket.
      if (!hasStoredAuth()) {
        void isPublicDirectSession(directSharedSessionId).then((accessible) => {
          if (accessible) enterReadOnlyGuestMode();
        });
      } else {
        void (async () => {
          const loggedIn = await useAuthStore.getState().tryAutoLogin();
          if (!loggedIn && await isPublicDirectSession(directSharedSessionId)) {
            enterReadOnlyGuestMode();
          }
        })();
      }
      return;
    }
    void useAuthStore.getState().tryAutoLogin();
  }, []);

  return (
    <>
      {isMessageRenderPath ? (
        <Suspense fallback={null}><MessageRenderPage /></Suspense>
      ) : directGroupRoute ? (
        <BrowserRouter>
          <Suspense fallback={null}>
            <GroupPreviewApp botSlug={directGroupRoute.botSlug} channelId={directGroupRoute.channelId} />
          </Suspense>
        </BrowserRouter>
      ) : groupMatch ? (
        <BrowserRouter>
          <Suspense fallback={null}>
            <GroupPreviewApp botSlug={decodeURIComponent(groupMatch[1]!)} channelId={decodeURIComponent(groupMatch[2]!)} />
          </Suspense>
        </BrowserRouter>
      ) : (
      <BrowserRouter>
        <Routes>
          <Route path="/logout" element={<LogoutView />} />
          <Route path="*" element={<MainApp />} />
        </Routes>
      </BrowserRouter>
      )}
    </>
  );
}

function MainApp() {
  const { isLoggedIn, isLoading } = useAuthStore();
  const location = useLocation();
  const urlSessionId = parseSessionIdFromPath(location.pathname) ?? undefined;
  const sessionRoute = useChatSessionRoute();
  const chat = useChatWebSocket();
  useAccountProfileSync(isLoggedIn);

  // Block only on auth + workspace init. Session activate / Pi cold-open runs in the
  // background while the shell is visible (ChatPanel shows its own hydrating state).
  // At `/` we still gate until default session redirect finishes.
  // /chat/new is a transient route for session creation — never gate there.
  const showLoading =
    isLoading ||
    (isLoggedIn && !sessionRoute.routeReady) ||
    (isLoggedIn && sessionRoute.isSyncingSession && !urlSessionId && !isNewChatPath(location.pathname));

  return (
    <>
      <LoadingGate active={showLoading} />
      {!isLoggedIn && !isLoading && <LoginView />}
      {isLoggedIn && !showLoading && (
        <ChatWebSocketProvider value={chat}>
          <Routes>
            <Route path="/" element={<WorkspaceLayout />} />
            <Route path="/chat/new" element={<WorkspaceLayout />} />
            <Route path="/chat/:sessionId" element={<WorkspaceLayout />} />
            <Route path="/preview/:piSessionId" element={<WorkspaceLayout />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ChatWebSocketProvider>
      )}
    </>
  );
}
