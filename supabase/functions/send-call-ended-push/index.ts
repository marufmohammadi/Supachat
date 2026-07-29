import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.42.0';
import { corsHeaders } from '../_shared/cors.ts';
import { sendPushToSubscriptions, WebPushPayload } from '../_shared/webpush.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const record = body.record || body;

    if (!record || !record.id) {
      return new Response(JSON.stringify({ error: 'Missing record payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const { id: callId, status, receiver_id, caller_id } = record;

    if (!['ended', 'rejected', 'cancelled'].includes(status)) {
      return new Response(JSON.stringify({ message: `Ignoring status: ${status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Target both caller and receiver to dismiss call UI / notifications
    const targetUserIds = [receiver_id, caller_id].filter(Boolean);

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', targetUserIds);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No active push subscriptions for call participants' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: WebPushPayload = {
      title: 'Call Ended',
      body: status === 'rejected' ? 'Call was declined' : 'Call ended',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `call-${callId}`, // Matches call tag so browser replaces ringing notification
      callId,
      type: 'call_ended',
      data: {
        callId,
        status,
        type: 'call_ended',
      },
    };

    const results = await sendPushToSubscriptions(supabase, subscriptions, payload);

    return new Response(
      JSON.stringify({ success: true, callId, status, deliveredCount: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[SEND-CALL-ENDED-PUSH] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
