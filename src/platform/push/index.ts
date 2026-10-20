// Push notifications behind one interface. The web version uses standard
// Web Push; a native App Store version can add push/index.native.ts without
// touching the screens.

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** What a phone needs to tell the server: where and with which keys to send. */
export type PushKeys = { endpoint: string; p256dh: string; auth: string };

export interface PushService {
  /** Push is available here (iOS: only inside the Home Screen app, iOS 16.4+). */
  isSupported(): boolean;
  permission(): PushPermission;
  /** This phone's current subscription, if any. */
  current(): Promise<PushKeys | null>;
  /**
   * Asks for permission and subscribes. Must be called right in the tap
   * handler: iPhone shows the question only after a tap.
   */
  subscribe(publicKey: string): Promise<PushKeys>;
  /** Unsubscribes this phone; returns the old address, if there was one. */
  unsubscribe(): Promise<string | null>;
}

function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keysOf(sub: PushSubscription): PushKeys {
  return { endpoint: sub.endpoint, p256dh: toBase64Url(sub.getKey('p256dh')), auth: toBase64Url(sub.getKey('auth')) };
}

// The service worker registration, looked up early so a tap goes straight to
// subscribe (an extra wait could lose the tap on iPhone).
let registration: Promise<ServiceWorkerRegistration> | null = null;
function ready() {
  // No service worker within 5 seconds (blocked, or the page is not the app):
  // treat as «not subscribed» instead of waiting forever.
  registration ??= Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no service worker')), 5000)),
  ]);
  registration.catch(() => {
    registration = null;
  });
  return registration;
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
  async current() {
    if (!this.isSupported()) return null;
    const sub = await (await ready()).pushManager.getSubscription();
    return sub ? keysOf(sub) : null;
  },
  async subscribe(publicKey) {
    const reg = await ready();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
    return keysOf(sub);
  },
  async unsubscribe() {
    if (!this.isSupported()) return null;
    const sub = await (await ready()).pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
    return endpoint;
  },
};

/** Looks up the service worker ahead of the first tap. */
export function warmUpPush() {
  if (push.isSupported()) void ready();
}
