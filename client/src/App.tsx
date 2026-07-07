import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { useSessionStore } from "./stores/sessionStore";
import { useChatStore } from "./stores/chatStore";
import { parseSessionIdFromPath } from "./lib/chatRoutes";
import { LoginView } from "./components/login/LoginView";
import { LogoutView } from "./components/logout/LogoutView";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { NotificationStack } from "./components/common/NotificationStack";
import { LoadingGate } from "./components/common/LoadingGate";
import { useChatSessionRoute } from "./hooks/useChatSessionRoute";
import { useChatWebSocket } from "./hooks/useChatWebSocket";
import { ChatWebSocketProvider } from "./context/chatWebSocketContext";
import { useAccountProfileSync } from "./hooks/useAccountProfileSync";

export default function App() {
  // 预览模式（路径 /preview/:piSessionId）
  const isPreviewPath = window.location.pathname.startsWith("/preview/");
  const previewPiSessionId = isPreviewPath
    ? window.location.pathname.slice("/preview/".length).split("?")[0]
    : undefined;

  const searchParams = new URLSearchParams(window.location.search);
  const isGuestView = searchParams.get("view") === "1";
  const guestPiSessionId = searchParams.get("piSessionId") ?? undefined;

  useEffect(() => {
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
    void useAuthStore.getState().tryAutoLogin();
  }, []);

  return (
    <>
      <NotificationStack />
      <BrowserRouter>
        <Routes>
          <Route path="/logout" element={<LogoutView />} />
          <Route path="*" element={<MainApp />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}

function MainApp() {
  const { isLoggedIn, isLoading } = useAuthStore();
  const activePiSessionId = useSessionStore((s) => s.activePiSessionId);
  const hydratedPiSessionId = useChatStore((s) => s.hydratedPiSessionId);
  const location = useLocation();
  const urlSessionId = parseSessionIdFromPath(location.pathname) ?? undefined;
  const sessionRoute = useChatSessionRoute();
  const chat = useChatWebSocket();
  useAccountProfileSync(isLoggedIn);

  // Gate until: auth done, workspace ready, session routed, AND chat hydrated
  // (messages actually rendered). ChatPanel uses its own hydrating state for the
  // centered-startup skeleton, but the global loader must stay until the last
  // message is visible to avoid a jarring flash.
  const showLoading =
    isLoading ||
    (isLoggedIn && !sessionRoute.routeReady) ||
    (isLoggedIn && sessionRoute.isSyncingSession && !urlSessionId) ||
    (isLoggedIn && Boolean(activePiSessionId && hydratedPiSessionId !== activePiSessionId));

  return (
    <>
      <LoadingGate active={showLoading} />
      {!isLoggedIn && !isLoading && <LoginView />}
      {isLoggedIn && !showLoading && (
        <ChatWebSocketProvider value={chat}>
          <Routes>
            <Route path="/" element={<WorkspaceLayout />} />
            <Route path="/chat/:sessionId" element={<WorkspaceLayout />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ChatWebSocketProvider>
      )}
    </>
  );
}
