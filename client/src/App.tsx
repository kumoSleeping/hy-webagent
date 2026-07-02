import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { useSessionStore } from "./stores/sessionStore";
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
  useEffect(() => {
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
  const location = useLocation();
  const urlSessionId = parseSessionIdFromPath(location.pathname) ?? undefined;
  const sessionRoute = useChatSessionRoute();
  const chat = useChatWebSocket();
  useAccountProfileSync(isLoggedIn);

  const sessionReady = urlSessionId
    ? activePiSessionId === urlSessionId
    : Boolean(activePiSessionId);

  const showLoading =
    isLoading || (isLoggedIn && (!sessionReady || sessionRoute.isSyncingSession));

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
