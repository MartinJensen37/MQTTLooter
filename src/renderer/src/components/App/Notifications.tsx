import { useCallback, useState } from 'react';

interface Notification {
  id: number;
  message: string;
  type: string;
}

const ICONS: Record<string, string> = {
  success: 'fa-check-circle',
  error: 'fa-exclamation-circle',
  warning: 'fa-exclamation-triangle',
};

/** Short messages in the corner that close themselves after two seconds. */
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const remove = useCallback((id: number) => {
    setNotifications((previous) => previous.filter((item) => item.id !== id));
  }, []);
  const showFeedback = useCallback(
    (message: string, type = 'success') => {
      const id = Date.now() + Math.random();
      setNotifications((previous) => [...previous, { id, message, type }]);
      setTimeout(() => remove(id), 2000);
    },
    [remove],
  );
  return { notifications, showFeedback, remove };
}

export function NotificationStack({
  notifications,
  onClose,
}: {
  notifications: Notification[];
  onClose: (id: number) => void;
}) {
  return (
    <div className="notification-stack">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification ${notification.type}`}
          onClick={() => onClose(notification.id)}
        >
          <i className={`fas ${ICONS[notification.type] ?? 'fa-info-circle'}`}></i>
          <span className="notification-message">{notification.message}</span>
          <button
            className="notification-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(notification.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
