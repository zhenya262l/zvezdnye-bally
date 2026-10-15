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

// Web Push (used from stage 2). Payload: {title, body, tag, url}.
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

// Tapping a notification opens (or focuses) the app on the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) ?? base, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        await w.focus();
        if ('navigate' in w) await w.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
