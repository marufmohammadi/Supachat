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

    if (!record) {
      return new Response(JSON.stringify({ error: 'Missing record payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Handle either calls record (status = missed) or call_logs record (status = missed)
    const status = record.status;
    if (status !== 'missed') {
      return new Response(JSON.stringify({ message: `Ignoring status: ${status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerId = record.caller_id;
    const receiverId = record.receiver_id;
    const callType = record.call_type || 'voice';

    if (!callerId || !receiverId) {
      return new Response(JSON.stringify({ error: 'Missing caller_id or receiver_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Fetch caller profile details
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .eq('id', callerId)
      .single();

    const callerName = callerProfile?.username || 'Unknown Contact';
    const callerAvatar = callerProfile?.avatar_url || '/icon-192-v2.png';

    // Fetch receiver push subscriptions
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .eq('user_id', receiverId);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No push subscriptions found for receiver' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: WebPushPayload = {
      title: '📵 Missed Call',
      body: `You missed a ${callType} call from ${callerName}`,
      icon: callerAvatar,
      badge: '/icon-192-v2.png',
      tag: `missed-call-${record.id || Date.now()}`,
      chatId: callerId,
      type: 'missed_call',
      data: {
        url: '/',
        chatId: callerId,
        chatType: 'direct',
        type: 'missed_call',
      },
    };

    const results = await sendPushToSubscriptions(supabase, subscriptions, payload);

    return new Response(
      JSON.stringify({ success: true, deliveredCount: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[SEND-MISSED-CALL-PUSH] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
