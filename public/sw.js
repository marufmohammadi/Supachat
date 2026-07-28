// SupaChat Production Service Worker
const CACHE_NAME = 'supachat-app-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png'
];

// 1. Installation - Cache static shell safely
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map(asset => cache.add(asset).catch(err => console.warn('Cache error for:', asset, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Activation - Clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch - Cache static resources; NEVER cache sensitive APIs, messages, or keys
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // NEVER cache non-GET requests, Supabase REST/Auth/Realtime APIs, or WebSocket calls
  if (
    req.method !== 'GET' ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/realtime/v1/') ||
    url.hostname.includes('supabase')
  ) {
    return; // Pass through directly to network
  }

  // Network-first strategy for app shell/static assets with fallback to cache
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors') &&
          !url.pathname.includes('/api/')
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (req.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// 4. Web Push Notification Handling
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'SupaChat';
  const options = {
    body: data.body || 'You have a new encrypted notification',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || (data.chatId ? `chat-${data.chatId}` : 'supachat-notification'),
    renotify: true,
    data: data.data || { url: data.url || '/' },
    actions: data.actions || []
  };

  // If incoming call, add Call Action buttons
  if (data.type === 'incoming_call') {
    options.requireInteraction = true;
    options.actions = [
      { action: 'accept', title: '📞 Answer' },
      { action: 'reject', title: '❌ Decline' }
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// 5. Notification Click & Actions Handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const callId = event.notification.tag ? event.notification.tag.replace('call-', '') : null;

  if (event.action === 'accept') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if (client.postMessage) {
              client.postMessage({ type: 'CALL_ACTION', action: 'accept', callId });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(`/?action=accept&callId=${callId}`);
        }
      })
    );
  } else if (event.action === 'reject') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if (client.postMessage) {
              client.postMessage({ type: 'CALL_ACTION', action: 'reject', callId });
            }
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(`/?action=reject&callId=${callId}`);
        }
      })
    );
  } else {
    const targetUrl = notificationData.url || '/';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if (notificationData.chatId && client.postMessage) {
              client.postMessage({ type: 'NAVIGATE_CHAT', chatId: notificationData.chatId, chatType: notificationData.chatType });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
    );
  }
});

// 6. Background Sync Listener
self.addEventListener('sync', (event) => {
  if (event.tag === 'pending-messages-sync' || event.tag === 'reconnect-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.postMessage) {
            client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGER' });
          }
        }
      })
    );
  }
});
