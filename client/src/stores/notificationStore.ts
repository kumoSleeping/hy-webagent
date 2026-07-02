import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  type?: "success" | "info";
  /** When true, the exit animation is playing */
  exiting?: boolean;
}

export interface NotificationState {
  notifications: Notification[];
  /** Push a notification; auto-removes after durationMs (default 3500) */
  notify: (message: string, type?: "success" | "info", durationMs?: number) => void;
  /** Start exit animation, then remove */
  dismiss: (id: string) => void;
  /** Force-remove without animation */
  remove: (id: string) => void;
}

let nextId = 0;
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  notify: (message, type = "info", durationMs = 3500) => {
    const existing = get().notifications.find(
      (n) => !n.exiting && n.message === message && (n.type ?? "info") === type
    );
    if (existing) {
      const prevTimer = dismissTimers.get(existing.id);
      if (prevTimer) clearTimeout(prevTimer);
      dismissTimers.set(
        existing.id,
        setTimeout(() => {
          dismissTimers.delete(existing.id);
          get().dismiss(existing.id);
        }, durationMs)
      );
      return;
    }

    const id = `notif-${++nextId}`;
    set((s) => ({
      notifications: [...s.notifications, { id, message, type, exiting: false }],
    }));

    dismissTimers.set(
      id,
      setTimeout(() => {
        dismissTimers.delete(id);
        get().dismiss(id);
      }, durationMs)
    );
  },

  dismiss: (id) => {
    const timer = dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, exiting: true } : n
      ),
    }));
    // Remove after exit animation completes.
    setTimeout(() => {
      get().remove(id);
    }, 240);
  },

  remove: (id) => {
    dismissTimers.delete(id);
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }));
  },
}));

/** @internal test helper */
export function resetNotificationStoreForTests() {
  for (const timer of dismissTimers.values()) clearTimeout(timer);
  dismissTimers.clear();
  useNotificationStore.setState({ notifications: [] });
  nextId = 0;
}
