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

    if (!record || !record.sender_id) {
      return new Response(JSON.stringify({ error: 'Invalid record payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const { sender_id, receiver_id, group_id, content_encrypted } = record;

    // Fetch sender profile details
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .eq('id', sender_id)
      .single();

    const senderName = senderProfile?.username || 'New Message';
    const senderAvatar = senderProfile?.avatar_url || '/icon-192.png';

    let recipientUserIds: string[] = [];

    if (group_id) {
      // Fetch group members except sender
      const { data: members } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', group_id)
        .neq('user_id', sender_id);

      if (members) {
        recipientUserIds = members.map((m: any) => m.user_id);
      }
    } else if (receiver_id) {
      recipientUserIds = [receiver_id];
    }

    if (recipientUserIds.length === 0) {
      return new Response(JSON.stringify({ message: 'No recipients found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch push subscriptions for all recipients
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', recipientUserIds);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: 'No push subscriptions registered for recipient(s)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare Web Push Payload
    const messageSnippet = content_encrypted
      ? '🔒 Encrypted message'
      : (record.content || 'Sent a message');

    const payload: WebPushPayload = {
      title: group_id ? `Group Message from ${senderName}` : senderName,
      body: messageSnippet,
      icon: senderAvatar,
      badge: '/icon-192.png',
      tag: group_id ? `group-${group_id}` : `direct-${sender_id}`,
      chatId: group_id || sender_id,
      type: 'message',
      data: {
        url: '/',
        chatId: group_id || sender_id,
        chatType: group_id ? 'group' : 'direct',
        type: 'message',
        senderId: sender_id,
      },
    };

    const results = await sendPushToSubscriptions(supabase, subscriptions, payload);

    return new Response(
      JSON.stringify({ success: true, deliveredCount: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[SEND-MESSAGE-PUSH] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
