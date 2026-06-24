import { supabase } from '../../lib/supabase';
import { CallRoom, CallParticipant, GroupCallSignal, GroupCallType } from '../../types/group-call';

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
    const channel = supabase
      .channel(`group_room_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_rooms',
          filter: `id=eq.${roomId}`
        },
        (payload) => {
          onUpdate(payload.new as CallRoom);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribes to dynamic group call signaling messages targeted for current user
   */
  subscribeToGroupSignals(roomId: string, userId: string, onSignal: (signal: GroupCallSignal) => void): () => void {
    const channel = supabase
      .channel(`group_signals_${roomId}_${userId}`)
      .on(
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
            onSignal(sig);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribes to dynamic participant actions (joining, leaving, muting, camera toggle)
   */
  subscribeToParticipants(roomId: string, onUpdate: () => void): () => void {
    const channel = supabase
      .channel(`group_participants_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_participants',
          filter: `room_id=eq.${roomId}`
        },
        () => {
          onUpdate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribes to new call rooms created in groups where the user is a member
   */
  subscribeToIncomingGroupCalls(userId: string, onIncoming: (room: CallRoom) => void): () => void {
    const channel = supabase
      .channel(`incoming_group_calls_${userId}`)
      .on(
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
              onIncoming(newRoom);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
};
