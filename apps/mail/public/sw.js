/**
 * Service Worker for Nubo Push Notifications
 */

// Install event - cache essential assets
self.addEventListener('install', () => {
  console.log('[ServiceWorker] Install');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(self.clients.claim());
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received');

  let data = {
    title: 'New Email',
    body: 'You have a new email',
    icon: '/icons-pwa/icon-192.png',
    badge: '/icons-pwa/icon-192.png',
    tag: 'nubo-notification',
    data: {},
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = {
        ...data,
        ...payload,
      };
    } catch (e) {
      console.error('[ServiceWorker] Error parsing push data:', e);
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons-pwa/icon-192.png',
    badge: data.badge || '/icons-pwa/icon-192.png',
    tag: data.tag || 'nubo-notification',
    data: data.data || {},
    vibrate: [100, 50, 100],
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    requireInteraction: false,
  };

  // For Electron, send message to main window to show native notification
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Send to all clients (including Electron window)
      clients.forEach((client) => {
        client.postMessage({
          type: 'PUSH_NOTIFICATION',
          title: data.title,
          body: data.body,
          icon: data.icon,
          tag: data.tag,
          data: data.data,
        });
      });

      // Also show via service worker for PWA/browser
      return self.registration.showNotification(data.title, options);
    }),
  );
});

// Notification click event - handle user interaction with notification
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click:', event.action);

  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  // Get the thread ID from notification data if available
  const data = event.notification.data || {};
  const threadId = data.threadId;
  const connectionId = data.connectionId;

  // Determine the URL to open
  let urlToOpen = '/mail/inbox';

  if (threadId && connectionId) {
    urlToOpen = `/mail/inbox?threadId=${threadId}&connectionId=${connectionId}`;
  } else if (data.url) {
    urlToOpen = data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already an open window
      for (const client of clientList) {
        if (client.url.includes('/mail') && 'focus' in client) {
          // Navigate existing window to the thread if specified
          if (threadId) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    }),
  );
});

// Notification close event
self.addEventListener('notificationclose', () => {
  console.log('[ServiceWorker] Notification closed');
});

// Message event - handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
