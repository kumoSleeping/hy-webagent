import { useEffect } from "react";
import { apiGet } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import type { AccountProfile } from "../types";

export async function fetchAccountProfile(): Promise<void> {
  const data = await apiGet<AccountProfile>("/api/auth/me");
  useAuthStore.getState().applyProfile(data);
}

/** Keep username/budget in sync — initial fetch + optional refresh triggers. */
export function useAccountProfileSync(enabled: boolean, refreshKey?: number | string | null) {
  useEffect(() => {
    if (!enabled) return;
    fetchAccountProfile().catch((err) => console.warn("account profile sync failed:", err));
  }, [enabled, refreshKey]);
}
