// Push notifications behind one interface. The web version uses standard
// Web Push (stage 2); a native App Store version can add push/index.native.ts
// without touching the screens.

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushService {
  /** Push is available here (iOS: only inside the Home Screen app, iOS 16.4+). */
  isSupported(): boolean;
  permission(): PushPermission;
}

export const push: PushService = {
  isSupported() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },
  permission() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission as PushPermission;
  },
};
