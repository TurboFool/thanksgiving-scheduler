let notificationsEnabled = true;

export function setBrowserNotificationsEnabled(enabled: boolean) {
  notificationsEnabled = enabled;
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export interface BrowserNotificationOptions {
  body?: string;
  tag?: string;
  requireInteraction?: boolean;
  force?: boolean;
}

export function sendBrowserNotification(
  title: string,
  options: BrowserNotificationOptions = {}
): boolean {
  if (!options.force && !notificationsEnabled) return false;
  if (!isNotificationSupported()) return false;
  if (window.Notification.permission !== 'granted') return false;

  try {
    const notif = new window.Notification(title, {
      body: options.body,
      tag: options.tag,
      requireInteraction: options.requireInteraction ?? false,
    });
    notif.onclick = () => {
      try {
        window.focus();
        notif.close();
      } catch {
        // ignore focus errors
      }
    };
    if (!options.requireInteraction) {
      window.setTimeout(() => {
        try {
          notif.close();
        } catch {
          // ignore close errors
        }
      }, 10_000);
    }
    return true;
  } catch {
    return false;
  }
}
