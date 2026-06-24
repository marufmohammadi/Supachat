import { supabase } from '../../lib/supabase';
import { Call, CallSignal, CallStatus, CallType } from '../../types/calls';

export const signalingService = {
  /**
   * Initiates a new call row in the database
   */
  async createCall(callerId: string, receiverId: string, callType: CallType): Promise<Call> {
    const { data, error } = await supabase
      .from('calls')
      .insert({
        caller_id: callerId,
        receiver_id: receiverId,
        call_type: callType,
        status: 'ringing',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[CALLS] Error creating call:', error);
      throw error;
    }

    return data as Call;
  },

  /**
   * Updates the status of an active call
   */
  async updateCallStatus(
    callId: string, 
    status: CallStatus, 
    updates?: { started_at?: string; ended_at?: string; duration?: number }
  ): Promise<Call> {
    const payload: any = { status };
    if (updates?.started_at) payload.started_at = updates.started_at;
    if (updates?.ended_at) payload.ended_at = updates.ended_at;
    if (updates?.duration !== undefined) payload.duration = updates.duration;

    const { data, error } = await supabase
      .from('calls')
      .update(payload)
      .eq('id', callId)
      .select()
      .single();

    if (error) {
      console.error('[CALLS] Error updating call status:', error);
      throw error;
    }

    return data as Call;
  },

  /**
   * Adds a permanent entry into call logs
   */
  async logCall(
    callerId: string, 
    receiverId: string, 
    callType: CallType, 
    status: CallStatus, 
    duration: number
  ): Promise<void> {
    const { error } = await supabase
      .from('call_logs')
      .insert({
        caller_id: callerId,
        receiver_id: receiverId,
        call_type: callType,
        status,
        duration
      });

    if (error) {
      console.error('[CALLS] Error saving call log:', error);
    }
  },

  /**
   * Fetch call logs history
   */
  async fetchCallLogs(userId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('call_logs')
      .select(`
        id,
        caller_id,
        receiver_id,
        call_type,
        status,
        duration,
        created_at,
        caller:profiles!call_logs_caller_id_fkey(id, username, avatar_url),
        receiver:profiles!call_logs_receiver_id_fkey(id, username, avatar_url)
      `)
      .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CALLS] Error fetching call logs:', error);
      return [];
    }

    return data || [];
  },

  /**
   * Send a WebRTC signaling message
   */
  async sendSignal(callId: string, senderId: string, type: 'offer' | 'answer' | 'candidate' | 'hangup', data: any): Promise<void> {
    const { error } = await supabase
      .from('call_signals')
      .insert({
        call_id: callId,
        sender_id: senderId,
        type,
        data
      });

    if (error) {
      console.error('[CALLS] Error sending signal:', error);
      throw error;
    }
  },

  /**
   * Subscribe to WebRTC signaling messages for a specific call
   */
  subscribeToSignals(callId: string, onSignal: (signal: CallSignal) => void) {
    const channel = supabase
      .channel(`call_signals:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `call_id=eq.${callId}`
        },
        (payload) => {
          onSignal(payload.new as CallSignal);
        }
      )
      .subscribe((status) => {
        console.log(`[CALLS] Signaling subscription status for ${callId}:`, status);
      });

    return () => {
      console.log(`[CALLS] Unsubscribing from signals for ${callId}`);
      supabase.removeChannel(channel);
    };
  },

  /**
   * Listen for incoming calls for the current user
   */
  subscribeToIncomingCalls(userId: string, onCall: (call: Call) => void) {
    const channel = supabase
      .channel(`incoming_calls:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        },
        (payload) => {
          const call = payload.new as Call;
          if (call.status === 'ringing') {
            onCall(call);
          }
        }
      )
      .subscribe((status) => {
        console.log(`[CALLS] Incoming calls subscription status for ${userId}:`, status);
      });

    return () => {
      console.log(`[CALLS] Unsubscribing from incoming calls for ${userId}`);
      supabase.removeChannel(channel);
    };
  },

  /**
   * Listen for status updates on a specific call
   */
  subscribeToCallUpdates(callId: string, onUpdate: (call: Call) => void) {
    const channel = supabase
      .channel(`call_updates:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${callId}`
        },
        (payload) => {
          onUpdate(payload.new as Call);
        }
      )
      .subscribe((status) => {
        console.log(`[CALLS] Call updates subscription status for ${callId}:`, status);
      });

    return () => {
      console.log(`[CALLS] Unsubscribing from call updates for ${callId}`);
      supabase.removeChannel(channel);
    };
  }
};
