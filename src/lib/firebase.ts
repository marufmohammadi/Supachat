import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore, doc, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { supabase } from './supabase';
import { withTimeout } from '../utils/timeout';

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);

let messagingInstance: Messaging | null = null;

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance;
  try {
    const supported = await isSupported();
    if (supported) {
      messagingInstance = getMessaging(app);
      return messagingInstance;
    }
  } catch (err) {
    console.warn('[FCM] Firebase Messaging is not supported or failed to initialize:', err);
  }
  return null;
}

export async function requestFCMToken(userId: string, deviceId: string = 'primary'): Promise<string | null> {
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[FCM] Notification permission denied');
        return null;
      }
    }

    const swReg = await navigator.serviceWorker.ready;
    
    // Get FCM registration token using VAPID key / serviceWorkerRegistration
    const token = await getToken(messaging, {
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      console.log('[FCM] FCM Token obtained:', token);

      // Save token to Firestore fcm_tokens collection
      try {
        const tokenRef = doc(db, 'fcm_tokens', `${userId}_${deviceId}`);
        await setDoc(tokenRef, {
          userId,
          deviceId,
          token,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        console.log('[FCM] Saved token to Firestore');
      } catch (e) {
        console.warn('[FCM] Could not store FCM token to Firestore:', e);
      }

      // Save token to Supabase push_tokens table as well
      try {
        await supabase.from('push_tokens').upsert({
          user_id: userId,
          token: token,
          created_at: new Date().toISOString(),
        });
        console.log('[FCM] Saved FCM token to Supabase push_tokens');
      } catch (e) {
        console.warn('[FCM] Could not store token to Supabase push_tokens:', e);
      }

      return token;
    }
  } catch (err) {
    console.warn('[FCM] Error obtaining FCM Token:', err);
  }
  return null;
}

export async function initFCMForegroundListener(onMessageReceived?: (payload: any) => void) {
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return;

    onMessage(messaging, (payload) => {
      console.log('[FCM] Foreground message received:', payload);
      
      if (onMessageReceived) {
        onMessageReceived(payload);
      }

      // Requirement 6: Do NOT show duplicate system notifications if the app is open/foreground
      // In-app UI (toasts/modals/realtime signals) will handle foreground notifications.
      if (document.visibilityState !== 'visible' && payload.notification?.title) {
        new Notification(payload.notification.title, {
          body: payload.notification.body,
          icon: payload.notification.icon || '/icon-192-v2.png',
          data: payload.data,
        });
      }
    });
  } catch (err) {
    console.warn('[FCM] Failed to set up foreground listener:', err);
  }
}

export { app };
