import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.42.0';

export interface PushSubscriptionItem {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  callId?: string;
  chatId?: string;
  type?: string;
  data?: Record<string, any>;
  actions?: Array<{ action: string; title: string }>;
}

export function initVapidKeys() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || Deno.env.get('VITE_VAPID_PUBLIC_KEY') || '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@supachat.app';

  if (!publicKey || !privateKey) {
    console.warn('[WEBPUSH] VAPID keys not fully configured in environment secrets');
  } else {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch (err) {
      console.error('[WEBPUSH] Error setting VAPID details:', err);
    }
  }

  return { publicKey, privateKey, subject };
}

export async function sendPushToSubscriptions(
  supabaseClient: any,
  subscriptions: PushSubscriptionItem[],
  payload: WebPushPayload
) {
  initVapidKeys();

  const payloadString = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payloadString);
        console.log(`[WEBPUSH] Successfully sent push to endpoint: ${sub.endpoint.slice(0, 30)}...`);
        return { success: true, id: sub.id };
      } catch (err: any) {
        console.error(`[WEBPUSH] Failed to send push to subscription ${sub.id}:`, err?.statusCode || err?.message);
        
        // 404 or 410 Gone means subscription expired/unsubscribed; delete from DB
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          console.log(`[WEBPUSH] Removing expired subscription ${sub.id}`);
          await supabaseClient.from('push_subscriptions').delete().eq('id', sub.id);
        }
        return { success: false, id: sub.id, error: err?.message };
      }
    })
  );

  return results;
}
