import { X } from "lucide-react";
import { useNotificationStore, type Notification } from "../../stores/notificationStore";

const BADGE = {
  success: "OK",
  info: "Info",
} as const;

function NotificationItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismiss);
  const type = notification.type === "success" ? "success" : "info";

  return (
    <div
      className={`pi-notification ${
        notification.exiting ? "pi-notification--exit" : "pi-notification--enter"
      }`}
    >
      <div className="pi-corner-badge pi-notification-badge">
        {BADGE[type]}
      </div>

      <p className="pi-notification-message">
        {notification.message}
      </p>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); dismiss(notification.id); }}
        className="pi-notification-close"
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function NotificationStack() {
  const notifications = useNotificationStore((s) => s.notifications);

  if (notifications.length === 0) return null;

  return (
    <div className="pi-notification-stack">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <NotificationItem notification={n} />
        </div>
      ))}
    </div>
  );
}
