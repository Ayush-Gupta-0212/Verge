'use client';

// Thin wrapper over the Web Notifications API + service-worker routed
// notifications (the only way to attach action buttons on most browsers).
//
// Three pieces here:
//   • permission checks  — defensive, support-detected
//   • quiet hours        — silences notify() during the user's chosen window
//   • notify()           — prefers SW path so action buttons work
//
// Real server-driven push lives in lib/push.ts.

import { useUserStore } from '@/stores/useUserStore';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsGranted(): boolean {
  if (!notificationsSupported()) return false;
  return Notification.permission === 'granted';
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

// True if "now" falls inside the user's quiet-hours window. Wrap-around
// (e.g. 22 → 7) is handled by detecting start > end.
export function isQuietHourNow(now = new Date()): boolean {
  const p = useUserStore.getState().profile;
  if (!p?.quiet_hours_enabled) return false;
  const start = p.quiet_hours_start ?? 22;
  const end   = p.quiet_hours_end   ?? 7;
  const h = now.getHours();
  if (start === end) return false;        // no window
  if (start < end)   return h >= start && h < end;       // same-day window
  return h >= start || h < end;                          // wraps midnight
}

interface NotifyOptions {
  /** Tag — dedupes; later notifications with the same tag replace earlier. */
  tag?: string;
  /** Action buttons (only fire when the SW path is used). */
  actions?: Array<{ action: string; title: string }>;
  /** Arbitrary metadata routed back to the SW notificationclick handler. */
  data?: Record<string, unknown>;
  /** Skip the quiet-hours gate (used for in-app feedback we always want). */
  bypassQuietHours?: boolean;
}

export function notify(title: string, body?: string, opts: NotifyOptions = {}): void {
  if (!notificationsGranted()) return;
  if (!opts.bypassQuietHours && isQuietHourNow()) return;

  const data = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: opts.tag,
    data: opts.data ?? {},
    actions: opts.actions ?? [],
  };

  // Prefer the service-worker path when available — only it can render
  // action buttons. Fall back to a raw Notification for older browsers.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, data))
      .catch(() => fallbackNotify(title, data));
    return;
  }
  fallbackNotify(title, data);
}

function fallbackNotify(
  title: string,
  data: { body?: string; icon?: string; tag?: string },
): void {
  try {
    new Notification(title, {
      body: data.body,
      icon: data.icon ?? '/favicon.ico',
      tag: data.tag,
    });
  } catch {
    // Some browsers throw if the page isn't visible — swallow.
  }
}
