// SupaChat Production Service Worker - High Performance Instant Load
const CACHE_NAME = 'supachat-app-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192-v2.png',
  '/icon-512-v2.png',
  '/icon-maskable-192-v2.png',
  '/icon-maskable-512-v2.png',
  '/favicon.ico'
];

// 1. Installation - Cache static shell safely and skip waiting immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map(asset => cache.add(asset).catch(err => console.warn('[SW] Cache add warning:', asset, err)))
      );
    })
  );
});

// 2. Activation - Clean up legacy caches and claim clients immediately
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

// 3. Fetch - Stale-While-Revalidate strategy for Instant App Boot (<50ms)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // NEVER cache non-GET requests, Supabase REST/Auth/Realtime APIs, or WebSocket connections
  if (
    req.method !== 'GET' ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/realtime/v1/') ||
    url.hostname.includes('supabase') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return; // Pass through directly to network
  }

  // Special handling for manifest.json: Network-first to ensure Android WebAPK updates immediately
  if (url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  const isAppShell =
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.includes('icon-') ||
    url.pathname === '/favicon.ico';

  if (isAppShell) {
    event.respondWith(
      caches.match(req).then((cachedResponse) => {
        // Background network update to keep cache warm and up-to-date
        const networkFetch = fetch(req)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn('[SW] Background network update fallback:', err);
          });

        // Instant response from local cache if present (<20ms boot), revalidate in background
        if (cachedResponse) {
          event.waitUntil(networkFetch);
          return cachedResponse;
        }

        // Cache miss (first launch) -> Wait for network, fallback to index.html
        return networkFetch.then((res) => {
          if (res) return res;
          return caches.match('/index.html');
        }).catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // Default Stale-While-Revalidate for other static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((netRes) => {
          if (netRes && netRes.status === 200) {
            const copy = netRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return netRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
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
  const isCall = data.type === 'incoming_call' || (data.data && data.data.type === 'incoming_call');
  const callId = data.callId || (data.data && data.data.callId);

  const options = {
    body: data.body || (isCall ? 'Incoming call...' : 'You have a new encrypted notification'),
    icon: data.icon || '/icon-192-v2.png',
    badge: data.badge || '/icon-192-v2.png',
    tag: isCall ? `call-${callId || Date.now()}` : (data.tag || (data.chatId ? `chat-${data.chatId}` : 'supachat-notification')),
    renotify: true,
    data: data.data || { url: data.url || '/', callId, chatId: data.chatId, type: data.type },
    vibrate: isCall ? [1000, 500, 1000, 500] : [200, 100, 200],
    actions: data.actions || []
  };

  // If incoming call, add Call Action buttons
  if (isCall) {
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
  const tagCallId = (event.notification.tag && event.notification.tag.startsWith('call-'))
    ? event.notification.tag.replace('call-', '')
    : null;
  const callId = notificationData.callId || tagCallId;
  const action = event.action;

  // Determine if this is a call notification
  const isCallNotification = Boolean(callId || notificationData.type === 'incoming_call' || (event.notification.tag && event.notification.tag.startsWith('call-')));

  if (action === 'accept' || (isCallNotification && !action)) {
    // Answer / Accept call or body click on call notification
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
          return self.clients.openWindow(`/?action=accept&callId=${callId || ''}`);
        }
      })
    );
  } else if (action === 'reject' || action === 'decline') {
    // Decline call
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
          return self.clients.openWindow(`/?action=reject&callId=${callId || ''}`);
        }
      })
    );
  } else {
    // Message / Chat Notification
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
