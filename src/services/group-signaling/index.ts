import { supabase } from '../../lib/supabase';
import { CallRoom, CallParticipant, GroupCallSignal, GroupCallType } from '../../types/group-call';
import { RealtimeChannel } from '@supabase/supabase-js';

class GroupCallRealtimeManagerClass {
  private channelsMap = new Map<string, {
    channel: RealtimeChannel;
    callbacks: Set<(payload: any) => void>;
  }>();

  getOrCreateChannel(
    channelName: string,
    onPayload: (payload: any) => void,
    setupOn: (channel: RealtimeChannel, handler: (payload: any) => void) => RealtimeChannel
  ): { channel: RealtimeChannel; unsubscribe: () => void } {
    console.log(`[REALTIME-MANAGER] getOrCreateChannel: ${channelName}`);

    let record = this.channelsMap.get(channelName);

    // If not in our map, check supabase.getChannels() to see if it exists there
    if (!record) {
      const existingChannels = supabase.getChannels();
      const match = existingChannels.find(
        (ch) => ch.topic === channelName || ch.topic === `realtime:${channelName}`
      );
      if (match) {
        console.log(`[REALTIME-MANAGER] Found stale/existing channel in Supabase for: ${channelName}. Removing it to rebuild cleanly.`);
        supabase.removeChannel(match);
      }
    }

    if (!record) {
      const callbacks = new Set<(payload: any) => void>();
      callbacks.add(onPayload);

      // Define the single multiplexed handler that calls all registered callbacks
      const multiplexedHandler = (payload: any) => {
        console.log(`[REALTIME-MANAGER] Multiplexed event triggered for: ${channelName}, callbacks count: ${callbacks.size}`);
        callbacks.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            console.error(`[REALTIME-MANAGER] Error in callback for ${channelName}:`, err);
          }
        });
      };

      // Create a fresh channel
      let channel = supabase.channel(channelName);

      // Register the postgres_changes listener BEFORE subscribing
      channel = setupOn(channel, multiplexedHandler);

      console.log(`[REALTIME-MANAGER] Subscribing to new channel: ${channelName}`);
      channel.subscribe();

      record = {
        channel,
        callbacks
      };
      this.channelsMap.set(channelName, record);
    } else {
      console.log(`[REALTIME-MANAGER] Reusing existing active channel: ${channelName}. Adding callback.`);
      record.callbacks.add(onPayload);
    }

    const currentRecord = record;

    return {
      channel: currentRecord.channel,
      unsubscribe: () => {
        console.log(`[REALTIME-MANAGER] Unsubscribe requested for: ${channelName}`);
        currentRecord.callbacks.delete(onPayload);

        if (currentRecord.callbacks.size === 0) {
          console.log(`[REALTIME-MANAGER] No more callbacks for ${channelName}. Removing channel entirely.`);
          supabase.removeChannel(currentRecord.channel);
          this.channelsMap.delete(channelName);
        } else {
          console.log(`[REALTIME-MANAGER] Channel ${channelName} still has ${currentRecord.callbacks.size} callbacks remaining.`);
        }
      }
    };
  }
}

export const GroupCallRealtimeManager = new GroupCallRealtimeManagerClass();

export const groupSignalingService = {
  /**
   * Creates a new group call room
   */
  async createCallRoom(groupId: string, callType: GroupCallType, createdByUserId: string): Promise<CallRoom> {
    const { data, error } = await supabase
      .from('call_rooms')
      .insert({
        group_id: groupId,
        call_type: callType,
        created_by: createdByUserId,
        status: 'ringing'
      })
      .select()
      .single();

    if (error) {
      console.error('[GROUP-CALL] Error creating call room:', error);
      throw error;
    }
    return data as CallRoom;
  },

  /**
   * Fetches the current active call room for a group, if any exists
   */
  async fetchActiveRoomForGroup(groupId: string): Promise<CallRoom | null> {
    const { data, error } = await supabase
      .from('call_rooms')
      .select('*')
      .eq('group_id', groupId)
      .in('status', ['ringing', 'active'])
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (error) {
      console.warn('[GROUP-CALL] Error fetching active room for group:', error);
      return null;
    }
    return data as CallRoom | null;
  },

  /**
   * Fetches details of a specific call room
   */
  async fetchCallRoom(roomId: string): Promise<CallRoom | null> {
    const { data, error } = await supabase
      .from('call_rooms')
      .select('*')
      .eq('id', roomId)
      .maybeSingle();

    if (error) {
      console.error('[GROUP-CALL] Error fetching call room:', error);
      return null;
    }
    return data as CallRoom | null;
  },

  /**
   * Updates status of a call room
   */
  async updateRoomStatus(roomId: string, status: 'ringing' | 'active' | 'ended'): Promise<void> {
    const { error } = await supabase
      .from('call_rooms')
      .update({ status })
      .eq('id', roomId);

    if (error) {
      console.error('[GROUP-CALL] Error updating room status:', error);
    }
  },

  /**
   * Joins a group call room (upserts a participant row)
   */
  async joinCallRoom(roomId: string, userId: string, isMuted: boolean, cameraEnabled: boolean): Promise<CallParticipant> {
    const { data, error } = await supabase
      .from('call_participants')
      .upsert({
        room_id: roomId,
        user_id: userId,
        joined_at: new Date().toISOString(),
        left_at: null,
        is_muted: isMuted,
        camera_enabled: cameraEnabled
      }, { onConflict: 'room_id,user_id' })
      .select()
      .single();

    if (error) {
      console.error('[GROUP-CALL] Error joining call room:', error);
      throw error;
    }

    // Attempt to update room status to active if still ringing
    const room = await this.fetchCallRoom(roomId);
    if (room && room.status === 'ringing') {
      await this.updateRoomStatus(roomId, 'active');
    }

    return data as CallParticipant;
  },

  /**
   * Updates a participant's local state (mute/unmute, camera on/off)
   */
  async updateParticipantState(roomId: string, userId: string, updates: Partial<CallParticipant>): Promise<void> {
    const { error } = await supabase
      .from('call_participants')
      .update(updates)
      .eq('room_id', roomId)
      .eq('user_id', userId);

    if (error) {
      console.warn('[GROUP-CALL] Error updating participant state:', error);
    }
  },

  /**
   * Sets left_at timestamp when a participant leaves the call room
   */
  async leaveCallRoom(roomId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('call_participants')
      .update({
        left_at: new Date().toISOString()
      })
      .eq('room_id', roomId)
      .eq('user_id', userId);

    if (error) {
      console.error('[GROUP-CALL] Error leaving call room:', error);
    }

    // Check if any participants remain active in the room. If none, end the call.
    const activeParticipants = await this.fetchActiveParticipants(roomId);
    if (activeParticipants.length === 0) {
      console.log(`[GROUP-CALL] No active participants left in room ${roomId}. Ending call room.`);
      await this.updateRoomStatus(roomId, 'ended');
    }
  },

  /**
   * Fetches only active participants for a specific room (left_at IS NULL)
   */
  async fetchActiveParticipants(roomId: string): Promise<CallParticipant[]> {
    const { data, error } = await supabase
      .from('call_participants')
      .select('*, profiles(username, avatar_url)')
      .eq('room_id', roomId)
      .is('left_at', null);

    if (error) {
      console.error('[GROUP-CALL] Error fetching active participants:', error);
      return [];
    }

    return (data || []).map((p: any) => ({
      id: p.id,
      room_id: p.room_id,
      user_id: p.user_id,
      joined_at: p.joined_at,
      left_at: p.left_at,
      is_muted: p.is_muted,
      camera_enabled: p.camera_enabled,
      profile: p.profiles ? {
        username: p.profiles.username,
        avatar_url: p.profiles.avatar_url
      } : undefined
    })) as CallParticipant[];
  },

  /**
   * Sends WebRTC signaling payload to a specific participant in the room
   */
  async sendSignal(roomId: string, senderId: string, receiverId: string, type: 'offer' | 'answer' | 'candidate', data: any): Promise<void> {
    const { error } = await supabase
      .from('group_call_signals')
      .insert({
        room_id: roomId,
        sender_id: senderId,
        receiver_id: receiverId,
        type,
        data
      });

    if (error) {
      console.error(`[GROUP-CALL] Error sending targeted signaling [${type}] to peer [${receiverId}]:`, error);
    }
  },

  /**
   * Subscribes to real-time status changes of a call room
   */
  subscribeToRoomUpdates(roomId: string, onUpdate: (room: CallRoom) => void): () => void {
    const channelName = `group_room_${roomId}`;
    const { unsubscribe } = GroupCallRealtimeManager.getOrCreateChannel(
      channelName,
      onUpdate,
      (channel, handler) => {
        return channel.on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'call_rooms',
            filter: `id=eq.${roomId}`
          },
          (payload) => {
            handler(payload.new as CallRoom);
          }
        );
      }
    );
    return unsubscribe;
  },

  /**
   * Subscribes to dynamic group call signaling messages targeted for current user
   */
  subscribeToGroupSignals(roomId: string, userId: string, onSignal: (signal: GroupCallSignal) => void): () => void {
    const channelName = `group_signals_${roomId}_${userId}`;
    const { unsubscribe } = GroupCallRealtimeManager.getOrCreateChannel(
      channelName,
      onSignal,
      (channel, handler) => {
        return channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'group_call_signals',
            filter: `room_id=eq.${roomId}`
          },
          (payload) => {
            const sig = payload.new as GroupCallSignal;
            if (sig.receiver_id === userId) {
              handler(sig);
            }
          }
        );
      }
    );
    return unsubscribe;
  },

  /**
   * Subscribes to dynamic participant actions (joining, leaving, muting, camera toggle)
   */
  subscribeToParticipants(roomId: string, onUpdate: () => void): () => void {
    const channelName = `group_participants_${roomId}`;
    const { unsubscribe } = GroupCallRealtimeManager.getOrCreateChannel(
      channelName,
      onUpdate,
      (channel, handler) => {
        return channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'call_participants',
            filter: `room_id=eq.${roomId}`
          },
          () => {
            handler(undefined);
          }
        );
      }
    );
    return unsubscribe;
  },

  /**
   * Subscribes to new call rooms created in groups where the user is a member
   */
  subscribeToIncomingGroupCalls(userId: string, onIncoming: (room: CallRoom) => void): () => void {
    const channelName = `incoming_group_calls_${userId}`;
    const { unsubscribe } = GroupCallRealtimeManager.getOrCreateChannel(
      channelName,
      onIncoming,
      (channel, handler) => {
        return channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'call_rooms'
          },
          async (payload) => {
            const newRoom = payload.new as CallRoom;
            if (newRoom.status === 'ringing' && newRoom.created_by !== userId) {
              // Verify membership
              const { data: member, error } = await supabase
                .from('group_members')
                .select('id')
                .eq('group_id', newRoom.group_id)
                .eq('user_id', userId)
                .maybeSingle();

              if (!error && member) {
                handler(newRoom);
              }
            }
          }
        );
      }
    );
    return unsubscribe;
  }
};
