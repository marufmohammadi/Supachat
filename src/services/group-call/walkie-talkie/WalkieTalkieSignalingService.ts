import { supabase } from '../../../lib/supabase';

export interface WalkieTalkieRoom {
  id: string;
  group_id: string;
  created_by: string;
  status: 'active' | 'ended';
  created_at: string;
}

export interface WalkieTalkieMember {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

// Global flag to track if database tables are missing or failing, so we fall back to pure real-time signaling
let isDbFallbackMode = false;

export const walkieTalkieSignalingService = {
  /**
   * Fetches any active Walkie-Talkie room for a group
   */
  async fetchActiveRoomForGroup(groupId: string): Promise<WalkieTalkieRoom | null> {
    if (isDbFallbackMode) {
      console.log('[WALKIE-TALKIE] DB Fallback Mode active. Using virtual room for group:', groupId);
      return null; // Return null so a virtual room is created for the session
    }

    try {
      const { data, error } = await supabase
        .from('walkie_talkie_rooms')
        .select('*')
        .eq('group_id', groupId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (error) {
        // Table doesn't exist or query failed, trigger fallback mode
        console.warn('[WALKIE-TALKIE] Error or table missing. Switching to DB Fallback Mode:', error.message);
        isDbFallbackMode = true;
        return null;
      }
      return data as WalkieTalkieRoom | null;
    } catch (err) {
      console.warn('[WALKIE-TALKIE] Exception in fetchActiveRoomForGroup. Switching to DB Fallback Mode:', err);
      isDbFallbackMode = true;
      return null;
    }
  },

  /**
   * Creates a new Walkie-Talkie room for a group
   */
  async createRoom(groupId: string, createdByUserId: string): Promise<WalkieTalkieRoom> {
    const virtualRoom: WalkieTalkieRoom = {
      id: `virtual-${groupId}`,
      group_id: groupId,
      created_by: createdByUserId,
      status: 'active',
      created_at: new Date().toISOString()
    };

    if (isDbFallbackMode) {
      console.log('[WALKIE-TALKIE] DB Fallback Mode active. Returning virtual room:', virtualRoom.id);
      return virtualRoom;
    }

    try {
      const { data, error } = await supabase
        .from('walkie_talkie_rooms')
        .insert({
          group_id: groupId,
          created_by: createdByUserId,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        console.warn('[WALKIE-TALKIE] Error creating room in DB. Falling back to virtual room:', error.message);
        isDbFallbackMode = true;
        return virtualRoom;
      }
      return data as WalkieTalkieRoom;
    } catch (err) {
      console.warn('[WALKIE-TALKIE] Exception in createRoom. Falling back to virtual room:', err);
      isDbFallbackMode = true;
      return virtualRoom;
    }
  },

  /**
   * Joins a Walkie-Talkie room (upserts membership)
   */
  async joinRoom(roomId: string, userId: string): Promise<WalkieTalkieMember> {
    const virtualMember: WalkieTalkieMember = {
      id: `virtual-member-${userId}`,
      room_id: roomId,
      user_id: userId,
      joined_at: new Date().toISOString(),
      left_at: null
    };

    if (isDbFallbackMode || roomId.startsWith('virtual-')) {
      console.log('[WALKIE-TALKIE] Joining virtual room:', roomId);
      return virtualMember;
    }

    try {
      const { data, error } = await supabase
        .from('walkie_talkie_members')
        .upsert({
          room_id: roomId,
          user_id: userId,
          joined_at: new Date().toISOString(),
          left_at: null
        }, { onConflict: 'room_id,user_id' })
        .select()
        .single();

      if (error) {
        console.warn('[WALKIE-TALKIE] Error joining room in DB. Falling back to virtual membership:', error.message);
        isDbFallbackMode = true;
        return virtualMember;
      }
      return data as WalkieTalkieMember;
    } catch (err) {
      console.warn('[WALKIE-TALKIE] Exception in joinRoom. Falling back to virtual membership:', err);
      isDbFallbackMode = true;
      return virtualMember;
    }
  },

  /**
   * Leaves a Walkie-Talkie room
   */
  async leaveRoom(roomId: string, userId: string): Promise<void> {
    if (isDbFallbackMode || roomId.startsWith('virtual-')) {
      console.log('[WALKIE-TALKIE] Leaving virtual room:', roomId);
      return;
    }

    try {
      const { error } = await supabase
        .from('walkie_talkie_members')
        .update({
          left_at: new Date().toISOString()
        })
        .eq('room_id', roomId)
        .eq('user_id', userId);

      if (error) {
        console.warn('[WALKIE-TALKIE] Error leaving room in DB:', error.message);
      }

      // Check if any participants remain active in the room. If none, end the room.
      const { data: activeMembers, error: fetchError } = await supabase
        .from('walkie_talkie_members')
        .select('id')
        .eq('room_id', roomId)
        .is('left_at', null);

      if (!fetchError && (!activeMembers || activeMembers.length === 0)) {
        console.log(`[WALKIE-TALKIE] No active participants left in room ${roomId}. Ending room in DB.`);
        await supabase
          .from('walkie_talkie_rooms')
          .update({ status: 'ended' })
          .eq('id', roomId);
      }
    } catch (err) {
      console.warn('[WALKIE-TALKIE] Exception in leaveRoom:', err);
    }
  },

  /**
   * Broadcasts notifications to all members of a group about the Walkie-Talkie room
   */
  async notifyGroupMembers(room: WalkieTalkieRoom, currentUserId: string): Promise<void> {
    try {
      // Fetch all group members
      const { data: members, error } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', room.group_id);

      if (error) {
        console.error('[WALKIE-TALKIE] Error fetching group members to notify:', error);
        return;
      }

      if (!members || members.length === 0) return;

      const otherMembers = members.filter((m) => m.user_id !== currentUserId);
      console.log(`[WALKIE-TALKIE] Broadcasting notifications to ${otherMembers.length} group members...`);

      // Broadcast to each other member's notification channel
      for (const m of otherMembers) {
        const targetChannelName = `user_walkie_talkie_notifications:${m.user_id}`;
        const channel = supabase.channel(targetChannelName);

        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.send({
              type: 'broadcast',
              event: 'incoming_walkie_talkie',
              payload: room
            });
            // Clean up channel after short delay
            setTimeout(() => {
              supabase.removeChannel(channel);
            }, 1000);
          }
        });
      }
    } catch (err) {
      console.error('[WALKIE-TALKIE] Error in notifyGroupMembers:', err);
    }
  },

  /**
   * Subscribes to new Walkie-Talkie rooms created in groups where the user is a member
   */
  subscribeToIncomingWalkieTalkies(userId: string, onIncoming: (room: WalkieTalkieRoom) => void): () => void {
    const channelName = `user_walkie_talkie_notifications:${userId}`;
    console.log(`[WALKIE-TALKIE] Setting up independent real-time broadcast walkie-talkie subscription on: ${channelName}`);

    // Create standard broadcast receiver
    const channel = supabase.channel(channelName);
    
    channel.on('broadcast', { event: 'incoming_walkie_talkie' }, (payload) => {
      console.log('[WALKIE-TALKIE] Received real-time broadcast incoming walkie-talkie:', payload);
      if (payload.payload) {
        onIncoming(payload.payload as WalkieTalkieRoom);
      }
    });

    channel.subscribe((status) => {
      console.log(`[WALKIE-TALKIE] Subscription status for ${channelName}: ${status}`);
    });

    return () => {
      console.log(`[WALKIE-TALKIE] Removing independent broadcast walkie-talkie channel: ${channelName}`);
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribes to updates on a specific Walkie-Talkie room
   */
  subscribeToRoomUpdates(roomId: string, onUpdate: (room: WalkieTalkieRoom) => void): () => void {
    // Pure broadcast-based fallback for room updates. Since this isn't actively called in useWalkieTalkie, 
    // we make it a safe, no-operation independent broadcast channel to prevent any table replication errors.
    const channelName = `walkie_talkie_room_updates_${roomId}`;
    const channel = supabase.channel(channelName);

    channel.on('broadcast', { event: 'room_update' }, (payload) => {
      if (payload.payload) {
        onUpdate(payload.payload as WalkieTalkieRoom);
      }
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
};
