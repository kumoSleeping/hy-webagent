import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";

/** Web-only logout route — clears session and returns to the login screen. */
export function LogoutView() {
  const logout = useAuthStore((s) => s.logout);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await logout();
      if (!cancelled) setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  if (done) return <Navigate to="/" replace />;

  return null;
}
