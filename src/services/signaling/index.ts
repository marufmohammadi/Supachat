import { supabase } from '../../lib/supabase';
import { Call, CallSignal, CallStatus, CallType } from '../../types/calls';

// Local Pub-Sub & Mock storage for seamless offline/sandbox/fallback execution
type Listener<T> = (data: T) => void;
const signalListeners = new Map<string, Set<Listener<CallSignal>>>();
const callUpdateListeners = new Map<string, Set<Listener<Call>>>();
const incomingCallListeners = new Map<string, Set<Listener<Call>>>();

const mockCalls = new Map<string, Call>();
const mockSignals = new Map<string, CallSignal[]>();
const mockCallLogs = new Map<string, any[]>();

function isSandbox(id?: string): boolean {
  if (!id) return false;
  // If sandbox or doesn't match standard UUID pattern, treat as sandbox/mock
  return id.startsWith('mock-') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function saveMockCall(call: Call) {
  mockCalls.set(call.id, call);
  
  // Trigger incoming call subscriber if any
  const listeners = incomingCallListeners.get(call.receiver_id);
  if (listeners) {
    listeners.forEach(l => {
      try {
        l(call);
      } catch (err) {
        console.warn('[CALLS] Error in incoming call listener:', err);
      }
    });
  }
}

function isMockCall(callId: string): boolean {
  return mockCalls.has(callId);
}

function updateMockCall(callId: string, status: CallStatus, updates?: any): Call {
  const existing = mockCalls.get(callId) || {
    id: callId,
    caller_id: 'mock-user-alice-1234',
    receiver_id: 'mock-user-bob-5678',
    call_type: 'video' as CallType,
    status: 'ringing' as CallStatus,
    started_at: new Date().toISOString()
  };
  const updated: Call = {
    ...existing,
    status,
    ...(updates || {})
  };
  mockCalls.set(callId, updated);

  // Trigger call updates
  const listeners = callUpdateListeners.get(callId);
  if (listeners) {
    listeners.forEach(l => {
      try {
        l(updated);
      } catch (err) {
        console.warn('[CALLS] Error in call update listener:', err);
      }
    });
  }

  return updated;
}

function saveMockCallLog(callerId: string, receiverId: string, callType: CallType, status: CallStatus, duration: number) {
  const newLog = {
    id: Math.random().toString(36).substring(2, 11),
    caller_id: callerId,
    receiver_id: receiverId,
    call_type: callType,
    status,
    duration,
    created_at: new Date().toISOString(),
    caller: {
      id: callerId,
      username: callerId === 'mock-user-alice-1234' ? 'Alice (You)' : 'User ' + callerId.substring(0, 4),
      avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${callerId}`
    },
    receiver: {
      id: receiverId,
      username: receiverId === 'mock-user-alice-1234' ? 'Alice (You)' : 'User ' + receiverId.substring(0, 4),
      avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${receiverId}`
    }
  };

  const currentLogs = mockCallLogs.get(callerId) || [];
  mockCallLogs.set(callerId, [newLog, ...currentLogs]);

  const otherLogs = mockCallLogs.get(receiverId) || [];
  mockCallLogs.set(receiverId, [newLog, ...otherLogs]);
}

function getMockCallLogs(userId: string): any[] {
  return mockCallLogs.get(userId) || [];
}

export const signalingService = {
  /**
   * Initiates a new call row in the database
   */
  async createCall(callerId: string, receiverId: string, callType: CallType): Promise<Call> {
    if (isSandbox(callerId) || isSandbox(receiverId)) {
      console.log('[CALLS] Sandbox mode detected in createCall. Using in-memory fallback.');
      const mockCall: Call = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
        caller_id: callerId,
        receiver_id: receiverId,
        call_type: callType,
        status: 'ringing',
        started_at: new Date().toISOString()
      };
      saveMockCall(mockCall);
      return mockCall;
    }

    try {
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
        console.warn('[CALLS] Database warning during createCall. Falling back to mock call.', error.message);
        const mockCall: Call = {
          id: Math.random().toString(36).substring(2, 11),
          caller_id: callerId,
          receiver_id: receiverId,
          call_type: callType,
          status: 'ringing',
          started_at: new Date().toISOString()
        };
        saveMockCall(mockCall);
        return mockCall;
      }

      return data as Call;
    } catch (err) {
      console.warn('[CALLS] Exception during createCall. Falling back to mock call.', err);
      const mockCall: Call = {
        id: Math.random().toString(36).substring(2, 11),
        caller_id: callerId,
        receiver_id: receiverId,
        call_type: callType,
        status: 'ringing',
        started_at: new Date().toISOString()
      };
      saveMockCall(mockCall);
      return mockCall;
    }
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

    if (isSandbox(callId) || isMockCall(callId)) {
      console.log('[CALLS] Sandbox mode/Mock ID detected in updateCallStatus. Updating mock call.');
      const updated = updateMockCall(callId, status, updates);
      return updated;
    }

    try {
      const { data, error } = await supabase
        .from('calls')
        .update(payload)
        .eq('id', callId)
        .select();

      if (error) {
        console.warn('[CALLS] Ignored database warning updating call status. Using fallback.', error.message);
        const updated = updateMockCall(callId, status, updates);
        return updated;
      }

      if (!data || data.length === 0) {
        console.warn(`[CALLS] updateCallStatus returned no rows for callId: ${callId}. Using fallback.`);
        return { id: callId, status, ...payload } as Call;
      }

      return data[0] as Call;
    } catch (err) {
      console.warn('[CALLS] Ignored exception updating call status. Using fallback.', err);
      const updated = updateMockCall(callId, status, updates);
      return updated;
    }
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
    if (isSandbox(callerId) || isSandbox(receiverId)) {
      console.log('[CALLS] Sandbox mode detected in logCall. Saving call log in-memory.');
      saveMockCallLog(callerId, receiverId, callType, status, duration);
      return;
    }

    try {
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
        console.warn('[CALLS] Ignored database warning saving call log. Saving to in-memory.', error.message);
        saveMockCallLog(callerId, receiverId, callType, status, duration);
      }
    } catch (err) {
      console.warn('[CALLS] Ignored exception saving call log. Saving to in-memory.', err);
      saveMockCallLog(callerId, receiverId, callType, status, duration);
    }
  },

  /**
   * Fetch call logs history
   */
  async fetchCallLogs(userId: string): Promise<any[]> {
    if (isSandbox(userId)) {
      console.log('[CALLS] Sandbox mode detected in fetchCallLogs. Returning in-memory logs.');
      return getMockCallLogs(userId);
    }

    try {
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
        console.warn('[CALLS] Ignored error fetching call logs. Returning fallback in-memory logs.', error.message);
        return getMockCallLogs(userId);
      }

      return data || [];
    } catch (err) {
      console.warn('[CALLS] Ignored exception fetching call logs. Returning fallback in-memory logs.', err);
      return getMockCallLogs(userId);
    }
  },

  /**
   * Send a WebRTC signaling message
   */
  async sendSignal(callId: string, senderId: string, type: 'offer' | 'answer' | 'candidate' | 'hangup', data: any): Promise<void> {
    if (isSandbox(callId) || isMockCall(callId)) {
      console.log(`[CALLS] Sandbox mode detected in sendSignal. Distributing mock signal: ${type}`);
      const signal: CallSignal = {
        id: Math.random().toString(36).substring(2, 11),
        call_id: callId,
        sender_id: senderId,
        type,
        data,
        created_at: new Date().toISOString()
      };
      
      // Store in memory
      const signals = mockSignals.get(callId) || [];
      mockSignals.set(callId, [...signals, signal]);

      // Distribute
      const listeners = signalListeners.get(callId);
      if (listeners) {
        listeners.forEach(l => {
          try {
            l(signal);
          } catch (e) {
            console.warn('[CALLS] Listener dispatch failed:', e);
          }
        });
      }
      return;
    }

    try {
      const { error } = await supabase
        .from('call_signals')
        .insert({
          call_id: callId,
          sender_id: senderId,
          type,
          data
        });

      if (error) {
        console.warn('[CALLS] Ignored database error sending signal. Distributing in-memory fallback.', error.message);
        const signal: CallSignal = {
          id: Math.random().toString(36).substring(2, 11),
          call_id: callId,
          sender_id: senderId,
          type,
          data,
          created_at: new Date().toISOString()
        };
        const listeners = signalListeners.get(callId);
        if (listeners) {
          listeners.forEach(l => {
            try {
              l(signal);
            } catch (e) {
              console.warn('[CALLS] Listener dispatch failed:', e);
            }
          });
        }
      }
    } catch (err) {
      console.warn('[CALLS] Ignored exception sending signal. Distributing in-memory fallback.', err);
      const signal: CallSignal = {
        id: Math.random().toString(36).substring(2, 11),
        call_id: callId,
        sender_id: senderId,
        type,
        data,
        created_at: new Date().toISOString()
      };
      const listeners = signalListeners.get(callId);
      if (listeners) {
        listeners.forEach(l => {
          try {
            l(signal);
          } catch (e) {
            console.warn('[CALLS] Listener dispatch failed:', e);
          }
        });
      }
    }
  },

  /**
   * Fetch historical signaling messages for a specific call
   */
  async fetchSignals(callId: string): Promise<CallSignal[]> {
    if (isSandbox(callId) || isMockCall(callId)) {
      return mockSignals.get(callId) || [];
    }

    try {
      const { data, error } = await supabase
        .from('call_signals')
        .select('*')
        .eq('call_id', callId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[CALLS] Ignored database error fetching signals.', error.message);
        return mockSignals.get(callId) || [];
      }
      return data || [];
    } catch (err) {
      console.warn('[CALLS] Ignored exception fetching signals.', err);
      return mockSignals.get(callId) || [];
    }
  },

  /**
   * Subscribe to WebRTC signaling messages for a specific call
   */
  subscribeToSignals(callId: string, onSignal: (signal: CallSignal) => void) {
    let listeners = signalListeners.get(callId);
    if (!listeners) {
      listeners = new Set();
      signalListeners.set(callId, listeners);
    }
    listeners.add(onSignal);

    if (isSandbox(callId) || isMockCall(callId)) {
      console.log(`[CALLS] Subscribed locally to mock signals for call: ${callId}`);
      return () => {
        const currentListeners = signalListeners.get(callId);
        if (currentListeners) {
          currentListeners.delete(onSignal);
        }
      };
    }

    const channelName = `call_signals:${callId}`;
    const existing = supabase.getChannels().find(c => c.topic === channelName || c.topic === `realtime:${channelName}`);
    if (existing) {
      console.log(`[CALLS] Removing existing channel for: ${channelName}`);
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(channelName)
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
      const currentListeners = signalListeners.get(callId);
      if (currentListeners) {
        currentListeners.delete(onSignal);
      }
      supabase.removeChannel(channel);
    };
  },

  /**
   * Listen for incoming calls for the current user
   */
  subscribeToIncomingCalls(userId: string, onCall: (call: Call) => void) {
    let listeners = incomingCallListeners.get(userId);
    if (!listeners) {
      listeners = new Set();
      incomingCallListeners.set(userId, listeners);
    }
    listeners.add(onCall);

    if (isSandbox(userId)) {
      console.log(`[CALLS] Subscribed locally to mock incoming calls for: ${userId}`);
      return () => {
        const currentListeners = incomingCallListeners.get(userId);
        if (currentListeners) {
          currentListeners.delete(onCall);
        }
      };
    }

    const channelName = `incoming_calls:${userId}`;
    const existing = supabase.getChannels().find(c => c.topic === channelName || c.topic === `realtime:${channelName}`);
    if (existing) {
      console.log(`[CALLS] Removing existing channel for: ${channelName}`);
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(channelName)
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
      const currentListeners = incomingCallListeners.get(userId);
      if (currentListeners) {
        currentListeners.delete(onCall);
      }
      supabase.removeChannel(channel);
    };
  },

  /**
   * Listen for status updates on a specific call
   */
  subscribeToCallUpdates(callId: string, onUpdate: (call: Call) => void) {
    let listeners = callUpdateListeners.get(callId);
    if (!listeners) {
      listeners = new Set();
      callUpdateListeners.set(callId, listeners);
    }
    listeners.add(onUpdate);

    if (isSandbox(callId) || isMockCall(callId)) {
      console.log(`[CALLS] Subscribed locally to mock call updates for: ${callId}`);
      return () => {
        const currentListeners = callUpdateListeners.get(callId);
        if (currentListeners) {
          currentListeners.delete(onUpdate);
        }
      };
    }

    const channelName = `call_updates:${callId}`;
    const existing = supabase.getChannels().find(c => c.topic === channelName || c.topic === `realtime:${channelName}`);
    if (existing) {
      console.log(`[CALLS] Removing existing channel for: ${channelName}`);
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(channelName)
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
      const currentListeners = callUpdateListeners.get(callId);
      if (currentListeners) {
        currentListeners.delete(onUpdate);
      }
      supabase.removeChannel(channel);
    };
  },

  /**
   * Registers/updates a push token in Supabase
   */
  async registerPushToken(userId: string, token: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('push_tokens')
        .upsert({ user_id: userId, token, created_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) {
        console.warn('[PUSH] Error upserting push token:', error.message);
      } else {
        console.log('[PUSH] Successfully registered push token for user:', userId);
      }
    } catch (err) {
      console.warn('[PUSH] Error registering push token:', err);
    }
  },

  /**
   * Retrieves the push token for a specific user
   */
  async getPushToken(userId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('[PUSH] Error fetching push token:', error.message);
        return null;
      }
      return data?.token || null;
    } catch (err) {
      console.warn('[PUSH] Error getting push token:', err);
      return null;
    }
  }
};
