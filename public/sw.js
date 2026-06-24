// Secure service worker for background and minimized browser push notification actions
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
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
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // If a window client is already open, focus it
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        // If no window is open, open the root path of the app
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    );
  }
});
