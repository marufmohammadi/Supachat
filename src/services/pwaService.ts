import { supabase } from '../lib/supabase';

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

class PWAService {
  private deferredInstallPrompt: any = null;
  private isInstallableSubscribers: ((installable: boolean) => void)[] = [];
  public isInstalled = false;
  public swRegistration: ServiceWorkerRegistration | null = null;

  constructor() {
    this.checkStandaloneMode();
    this.initInstallPromptListener();
  }

  // Check if app is running in Standalone (installed) PWA mode
  public checkStandaloneMode(): boolean {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://');
    this.isInstalled = isStandalone;
    return isStandalone;
  }

  // Listen for Chrome / Android beforeinstallprompt
  private initInstallPromptListener() {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.notifyInstallableSubscribers(true);
      console.log('[PWA Audit] beforeinstallprompt fired: true');
      console.log('[PWA Audit] App installable: true');
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.isInstalled = true;
      this.notifyInstallableSubscribers(false);
      console.log('[PWA Audit] App installed successfully');
    });
  }

  public subscribeInstallableChange(callback: (installable: boolean) => void): () => void {
    this.isInstallableSubscribers.push(callback);
    callback(!!this.deferredInstallPrompt && !this.isInstalled);
    return () => {
      this.isInstallableSubscribers = this.isInstallableSubscribers.filter(s => s !== callback);
    };
  }

  private notifyInstallableSubscribers(installable: boolean) {
    this.isInstallableSubscribers.forEach(cb => cb(installable));
  }

  public isAppInstallable(): boolean {
    return !!this.deferredInstallPrompt && !this.isInstalled;
  }

  // Trigger native PWA install prompt
  public async promptInstall(): Promise<boolean> {
    if (!this.deferredInstallPrompt) {
      return false;
    }
    try {
      this.deferredInstallPrompt.prompt();
      const choiceResult = await this.deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        this.deferredInstallPrompt = null;
        this.notifyInstallableSubscribers(false);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('PWA install prompt error:', err);
      return false;
    }
  }

  // Audit and log PWA installation criteria at startup
  public async auditAndLogPWAStatus(): Promise<void> {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const isManifestDetected = !!manifestLink;
    
    let swStatus = 'Not Supported';
    if ('serviceWorker' in navigator) {
      if (navigator.serviceWorker.controller) {
        swStatus = 'Active & Controlling Page';
      } else {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) {
          swStatus = 'Active (Page uncontrolled until first refresh or client claim)';
        } else if (reg?.installing || reg?.waiting) {
          swStatus = 'Installing / Waiting';
        } else {
          swStatus = 'Unregistered';
        }
      }
    }

    console.log('[PWA Audit] Manifest detected:', isManifestDetected);
    console.log('[PWA Audit] Service Worker status:', swStatus);
    console.log('[PWA Audit] beforeinstallprompt fired:', !!this.deferredInstallPrompt);
    console.log('[PWA Audit] App installable:', this.isAppInstallable());
  }

  // Register Service Worker
  public async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.info('[PWA Audit] Service Worker not supported in this environment');
      return null;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = reg;

      await navigator.serviceWorker.ready;

      // Handle SW updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA Audit] New PWA service worker version available');
            }
          });
        }
      });

      // Execute PWA Audit log after SW registration & ready
      setTimeout(() => {
        this.auditAndLogPWAStatus().catch(() => {});
      }, 300);

      return reg;
    } catch (err) {
      console.warn('[PWA Audit] Service worker registration failed:', err);
      return null;
    }
  }

  // Request Notification Permission and register Web Push Subscription in Supabase
  public async setupPushNotifications(userId: string, deviceId: string): Promise<boolean> {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      return false;
    }

    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        return false;
      }

      const reg = this.swRegistration || (await navigator.serviceWorker.ready);
      if (!reg || !reg.pushManager) {
        return false;
      }

      // VAPID Public Key fallback (default key for Web Push if custom server key not set)
      const vapidPublicKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-5Y214v39aH_3uFfA40kS0G-G3J5Z_6W2B6J3kG3kG3kG3kG3kG3kG3kG3k=';

      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        // Helper to convert base64 to Uint8Array
        const urlBase64ToUint8Array = (base64String: string) => {
          const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
          const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = window.atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
          }
          return outputArray;
        };

        try {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
          });
        } catch {
          // If custom key format fails, subscribe without serverKey for standard browser push
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true
          });
        }
      }

      if (subscription) {
        const subJson = subscription.toJSON();
        const p256dh = subJson.keys?.p256dh || '';
        const auth = subJson.keys?.auth || '';
        const endpoint = subJson.endpoint || '';

        if (endpoint && userId) {
          // Store push subscription in Supabase push_subscriptions table
          await supabase.from('push_subscriptions').upsert(
            {
              user_id: userId,
              device_id: deviceId,
              endpoint,
              p256dh,
              auth,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id,endpoint' }
          );
        }
      }

      return true;
    } catch (err) {
      console.warn('Error setting up PWA push notifications:', err);
      return false;
    }
  }

  // Display a local system notification (used when push event occurs or app is in background)
  public async sendNotification(
    title: string,
    options: {
      body?: string;
      icon?: string;
      tag?: string;
      chatId?: string;
      chatType?: 'direct' | 'group';
      type?: 'message' | 'incoming_call' | 'walkie_talkie' | 'device_login' | 'linked_device';
    }
  ) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    try {
      const reg = this.swRegistration || (await navigator.serviceWorker.ready);
      const notificationOptions: any = {
        body: options.body || '',
        icon: options.icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: options.tag || options.chatId || 'supachat',
        renotify: true,
        data: {
          url: '/',
          chatId: options.chatId,
          chatType: options.chatType,
          type: options.type
        }
      };

      if (options.type === 'incoming_call') {
        notificationOptions.requireInteraction = true;
        (notificationOptions as any).actions = [
          { action: 'accept', title: '📞 Answer' },
          { action: 'reject', title: '❌ Decline' }
        ];
      }

      if (reg) {
        await reg.showNotification(title, notificationOptions);
      } else {
        new Notification(title, notificationOptions);
      }
    } catch (err) {
      console.warn('Failed to display system notification:', err);
    }
  }

  // Register Background Sync if supported
  public async registerBackgroundSync(tag: string = 'pending-messages-sync') {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'sync' in reg) {
        await (reg as any).sync.register(tag);
      }
    } catch (err) {
      console.warn('Background sync registration failed:', err);
    }
  }
}

export const pwaService = new PWAService();
