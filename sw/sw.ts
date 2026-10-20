/// <reference lib="webworker" />
// Service worker: offline app shell (Workbox precache) + Web Push handlers.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// New version takes over on the next app launch.
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

// The app is a single page: every in-app address opens index.html.
const base = new URL(self.registration.scope).pathname;
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`)));

// Web Push. Payload from supabase/functions/push: {title, body, tag, url}.
// iPhone revokes the permission if a push shows nothing, so every push shows
// a notification.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Звёздные баллы', {
      body: data.body ?? '',
      tag: data.tag,
      icon: `${base}icons/icon-192.png`,
      badge: `${base}icons/icon-192.png`,
      data: { url: data.url ?? base },
    }),
  );
});

// Tapping a notification opens the app on the right screen. An open app is
// asked to switch screens itself (no reload); otherwise the app starts there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? base, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        try {
          w.postMessage({ type: 'zb-open', url: target });
          await w.focus();
          return;
        } catch {
          // This window cannot be used: try the next one or open a new one.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
