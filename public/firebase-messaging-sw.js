importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: "prismatic-resolver-z0bnn",
  appId: "1:229759347597:web:e3d77b109a882eb786abc4",
  apiKey: "AIzaSyDyKkph_-By4yPjr_Xru4ie7JW_pztJfPo",
  authDomain: "prismatic-resolver-z0bnn.firebaseapp.com",
  messagingSenderId: "229759347597",
  storageBucket: "prismatic-resolver-z0bnn.firebasestorage.app"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);
  
  const data = payload.data || {};
  const notification = payload.notification || {};

  const notificationTitle = notification.title || data.title || 'SupaChat Notification';
  const isCall = Boolean(
    data.type === 'incoming_call' ||
    data.type === 'call' ||
    data.callId ||
    (notificationTitle && (notificationTitle.includes('Call') || notificationTitle.includes('Walkie')))
  );

  const notificationOptions = {
    body: notification.body || data.body || (isCall ? 'Incoming call...' : 'You have a new message'),
    icon: notification.icon || data.icon || data.avatarUrl || '/icon-192-v2.png',
    badge: '/icon-192-v2.png',
    tag: data.tag || (data.callId ? `call-${data.callId}` : 'fcm-notification'),
    data: data,
    requireInteraction: isCall,
    vibrate: isCall ? [1000, 500, 1000, 500] : [200, 100, 200],
    actions: isCall
      ? [
          { action: 'accept', title: '📞 Answer' },
          { action: 'decline', title: '❌ Decline' }
        ]
      : (data.actions || [])
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const tagCallId = (event.notification.tag && event.notification.tag.startsWith('call-'))
    ? event.notification.tag.replace('call-', '')
    : null;
  const callId = notificationData.callId || tagCallId;
  const action = event.action;

  const isCallNotification = Boolean(callId || notificationData.type === 'incoming_call' || (event.notification.tag && event.notification.tag.startsWith('call-')));

  if (action === 'accept' || (isCallNotification && !action)) {
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
  } else if (action === 'decline' || action === 'reject') {
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

