import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { GroupWalkieTalkieManager, WalkieTalkieParticipant } from '../../services/group-call/walkie-talkie/WalkieTalkieService';
import { walkieTalkieSignalingService } from '../../services/group-call/walkie-talkie/WalkieTalkieSignalingService';

interface UseWalkieTalkieProps {
  currentUserId: string;
}

export const useWalkieTalkie = ({ currentUserId }: UseWalkieTalkieProps) => {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [participants, setParticipants] = useState<WalkieTalkieParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor' | 'connecting'>('connecting');
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [isLocalForceMuted, setIsLocalForceMuted] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);

  const managerRef = useRef<GroupWalkieTalkieManager | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);

  const updateActiveRoomId = (roomId: string | null) => {
    setActiveRoomId(roomId);
    activeRoomIdRef.current = roomId;
  };

  // Derive active speaker from active participants list
  const currentSpeaker = participants.find((p) => p.isSpeaking) || null;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.leave();
        managerRef.current = null;
      }
      const roomId = activeRoomIdRef.current;
      if (roomId) {
        walkieTalkieSignalingService.leaveRoom(roomId, currentUserId).catch((err) => {
          console.error('[USE-WALKIE-TALKIE] Error leaving room on unmount:', err);
        });
      }
    };
  }, [currentUserId]);

  /**
   * Leaves the Walkie-Talkie room and cleans up state
   */
  const leaveWalkieTalkie = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.leave();
      managerRef.current = null;
    }
    const roomId = activeRoomIdRef.current;
    if (roomId) {
      walkieTalkieSignalingService.leaveRoom(roomId, currentUserId).catch((err) => {
        console.error('[USE-WALKIE-TALKIE] Error leaving room:', err);
      });
    }
    setActiveGroupId(null);
    updateActiveRoomId(null);
    setIsJoined(false);
    setParticipants([]);
    setRemoteStreams(new Map());
    setIsConnecting(false);
    setConnectionQuality('connecting');
    setIsRoomLocked(false);
    setIsLocalForceMuted(false);
    setError(null);
    console.log('[USE-WALKIE-TALKIE] Cleaned up state and left Walkie-Talkie.');
  }, [currentUserId]);

  /**
   * Joins the Walkie-Talkie room for a group
   */
  const joinWalkieTalkie = useCallback(async (groupId: string, username: string, targetRoomId?: string) => {
    if (isJoined || isConnecting) {
      console.warn('[USE-WALKIE-TALKIE] Already joined or connecting to a Walkie-Talkie session.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setIsLocalForceMuted(false);
    setIsRoomLocked(false);

    try {
      // 1. Fetch user role in the group
      console.log(`[USE-WALKIE-TALKIE] Loading user role for group=${groupId}...`);
      
      // Check if user is group creator/owner
      const { data: groupData, error: groupErr } = await supabase
        .from('groups')
        .select('created_by')
        .eq('id', groupId)
        .maybeSingle();

      let role: 'owner' | 'admin' | 'member' = 'member';

      if (groupData && groupData.created_by === currentUserId) {
        role = 'owner';
      } else {
        // Check if user is an admin in group_members
        const { data: memberData } = await supabase
          .from('group_members')
          .select('role')
          .eq('group_id', groupId)
          .eq('user_id', currentUserId)
          .maybeSingle();

        if (memberData && memberData.role === 'admin') {
          role = 'admin';
        }
      }

      console.log(`[USE-WALKIE-TALKIE] Determined user role: ${role}`);
      setCurrentUserRole(role);

      // 2. Fetch or create Walkie-Talkie room
      let room;
      let isNewRoom = false;
      if (targetRoomId) {
        room = { id: targetRoomId, group_id: groupId, created_by: currentUserId, status: 'active' as const, created_at: new Date().toISOString() };
      } else {
        room = await walkieTalkieSignalingService.fetchActiveRoomForGroup(groupId);
        if (!room) {
          console.log('[USE-WALKIE-TALKIE] No active Walkie-Talkie room found. Creating new room...');
          room = await walkieTalkieSignalingService.createRoom(groupId, currentUserId);
          isNewRoom = true;
        } else {
          console.log('[USE-WALKIE-TALKIE] Found active Walkie-Talkie room:', room.id);
        }
      }

      // 3. Join the room in DB
      await walkieTalkieSignalingService.joinRoom(room.id, currentUserId);
      updateActiveRoomId(room.id);

      // Notify group members if we started/created the walkie talkie
      if (isNewRoom) {
        walkieTalkieSignalingService.notifyGroupMembers(room, currentUserId).catch((err) => {
          console.error('[USE-WALKIE-TALKIE] Error notifying group members of new Walkie-Talkie:', err);
        });
      }

      // 4. Initialize the Manager
      const manager = new GroupWalkieTalkieManager(
        groupId,
        room.id,
        currentUserId,
        username,
        role,
        {
          onParticipantsChanged: (newParticipants) => {
            setParticipants(newParticipants);
          },
          onRemoteStreamsChanged: (newStreams) => {
            setRemoteStreams(newStreams);
          },
          onSpeakingStateChanged: (userId, isSpeaking) => {
            console.log(`[USE-WALKIE-TALKIE] Speaking state changed: ${userId} isSpeaking=${isSpeaking}`);
          },
          onKicked: () => {
            setError('You have been removed from the Walkie-Talkie by an admin.');
            setIsJoined(false);
          },
          onForceMuted: () => {
            setIsLocalForceMuted(true);
            setError('You have been muted by an admin.');
          },
          onRoomLockChanged: (locked) => {
            setIsRoomLocked(locked);
          },
          onConnectionQualityChanged: (quality) => {
            setConnectionQuality(quality);
          },
        }
      );

      managerRef.current = manager;
      setActiveGroupId(groupId);

      // 5. Connect/Join via WebRTC and Realtime Presence
      await manager.join();
      setIsJoined(true);
      setIsConnecting(false);

    } catch (err: any) {
      console.error('[USE-WALKIE-TALKIE] Error joining Walkie-Talkie:', err);
      setError(err?.message || 'Failed to connect to the Walkie-Talkie room.');
      setIsConnecting(false);
      leaveWalkieTalkie();
    }
  }, [currentUserId, isJoined, isConnecting, leaveWalkieTalkie]);

  /**
   * PTT button press: start speaking
   */
  const startSpeaking = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.startSpeaking();
    }
  }, []);

  /**
   * PTT button release: stop speaking
   */
  const stopSpeaking = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.stopSpeaking();
    }
  }, []);

  /**
   * Admin action: mute a user
   */
  const muteUser = useCallback((userId: string) => {
    if (managerRef.current && currentUserRole !== 'member') {
      managerRef.current.sendAdminAction('mute', userId);
    }
  }, [currentUserRole]);

  /**
   * Admin action: kick a user
   */
  const kickUser = useCallback((userId: string) => {
    if (managerRef.current && currentUserRole !== 'member') {
      managerRef.current.sendAdminAction('kick', userId);
    }
  }, [currentUserRole]);

  /**
   * Admin action: Lock / Unlock the Walkie-Talkie room
   */
  const toggleRoomLock = useCallback(() => {
    if (managerRef.current && currentUserRole !== 'member') {
      const targetState = !isRoomLocked;
      managerRef.current.sendAdminAction(targetState ? 'lock_room' : 'unlock_room');
    }
  }, [currentUserRole, isRoomLocked]);

  return {
    activeGroupId,
    activeRoomId,
    isJoined,
    isConnecting,
    participants,
    remoteStreams,
    currentSpeaker,
    connectionQuality,
    isRoomLocked,
    isLocalForceMuted,
    currentUserRole,
    error,
    setError,
    joinWalkieTalkie,
    leaveWalkieTalkie,
    startSpeaking,
    stopSpeaking,
    muteUser,
    kickUser,
    toggleRoomLock,
  };
};
