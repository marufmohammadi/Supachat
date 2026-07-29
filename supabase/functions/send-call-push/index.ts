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

    if (!record || !record.id || !record.receiver_id) {
      return new Response(JSON.stringify({ error: 'Invalid call record' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Only send call push when status is 'ringing' or 'initiated'
    if (record.status !== 'ringing' && record.status !== 'initiated') {
      return new Response(JSON.stringify({ message: `Ignoring call status: ${record.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { id: callId, caller_id, receiver_id, call_type } = record;

    // Fetch caller profile details
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .eq('id', caller_id)
      .single();

    const callerName = callerProfile?.username || 'Someone';
    const callerAvatar = callerProfile?.avatar_url || '/icon-192.png';

    // Fetch receiver push subscriptions
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .eq('user_id', receiver_id);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No push subscription found for call receiver' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const formattedCallType =
      call_type === 'video'
        ? '📹 Incoming Video Call'
        : call_type === 'walkie_talkie'
        ? '📻 Walkie-Talkie Channel'
        : '📞 Incoming Voice Call';

    const payload: WebPushPayload = {
      title: formattedCallType,
      body: `${callerName} is calling you...`,
      icon: callerAvatar,
      badge: '/icon-192.png',
      tag: `call-${callId}`,
      callId,
      chatId: caller_id,
      type: 'incoming_call',
      data: {
        url: `/?action=accept&callId=${callId}`,
        callId,
        callerId: caller_id,
        callType: call_type || 'voice',
        type: 'incoming_call',
      },
      actions: [
        { action: 'accept', title: '📞 Answer' },
        { action: 'decline', title: '❌ Decline' },
      ],
    };

    const results = await sendPushToSubscriptions(supabase, subscriptions, payload);

    return new Response(
      JSON.stringify({ success: true, callId, deliveredCount: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[SEND-CALL-PUSH] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
