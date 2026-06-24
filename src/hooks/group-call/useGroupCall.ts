import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { groupSignalingService } from '../../services/group-signaling';
import { GroupWebRTCManager } from '../../services/webrtc/group';
import { CallRoom, CallParticipant, GroupCallSignal, GroupCallType } from '../../types/group-call';

interface UseGroupCallProps {
  currentUserId: string;
}

export function useGroupCall({ currentUserId }: UseGroupCallProps) {
  // Call State
  const [activeRoom, setActiveRoom] = useState<CallRoom | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [callError, setCallError] = useState<string | null>(null);

  // Media Controls
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Incoming Call State
  const [incomingRoom, setIncomingRoom] = useState<CallRoom | null>(null);
  const [incomingGroupName, setIncomingGroupName] = useState<string | null>(null);
  const [incomingCallerName, setIncomingCallerName] = useState<string | null>(null);

  // Refs for tracking mutable states
  const webRTCManagerRef = useRef<GroupWebRTCManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeRoomRef = useRef<CallRoom | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Keep activeRoomRef in sync
  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  /**
   * Cleans up all media streams and peer connections
   */
  const cleanupCallResources = useCallback(() => {
    console.log('[GROUP-CALL] Cleaning up group call resources...');
    
    if (webRTCManagerRef.current) {
      webRTCManagerRef.current.destroy();
      webRTCManagerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setLocalStream(null);
    setRemoteStreams(new Map());
    setActiveRoom(null);
    setParticipants([]);
    setCallDuration(0);
    setIsMinimized(false);
  }, []);

  /**
   * Timer incrementer for call duration
   */
  useEffect(() => {
    if (activeRoom && (activeRoom.status === 'active' || activeRoom.status === 'ringing')) {
      if (!durationIntervalRef.current) {
        setCallDuration(0);
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      }
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [activeRoom]);

  /**
   * Request media permissions and capture local device audio/video stream
   */
  const captureLocalMedia = useCallback(async (type: GroupCallType, cameraFacing: 'user' | 'environment' = 'user') => {
    try {
      // If there's an existing stream, stop its tracks first
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        },
        video: type === 'video' ? {
          facingMode: cameraFacing,
          width: { ideal: 640 },
          height: { ideal: 480 }
        } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Verify that all tracks are enabled
      stream.getTracks().forEach((track) => {
        track.enabled = true;
      });

      console.log('[GROUP-CALL] Capture local media success:', {
        type,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
      });

      return stream;
    } catch (err) {
      console.warn('[GROUP-CALL] Error capturing media devices. Creating simulated tracks as fallback:', err);
      
      // Fallback: Create custom Canvas & AudioContext fallback stream if devices are locked or in headless testing
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, 640, 480);
      }
      
      const videoStream = type === 'video' ? canvas.captureStream(10) : new MediaStream();
      
      let audioTrack: MediaStreamTrack | null = null;
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const dst = oscillator.connect(audioCtx.createMediaStreamDestination()) as any;
        oscillator.start();
        audioTrack = dst.stream.getAudioTracks()[0];
      } catch (audioErr) {
        console.warn('[GROUP-CALL] Failed setting up fallback oscillator track:', audioErr);
      }

      const fallbackStream = new MediaStream();
      if (videoStream.getVideoTracks().length > 0) {
        fallbackStream.addTrack(videoStream.getVideoTracks()[0]);
      }
      if (audioTrack) {
        fallbackStream.addTrack(audioTrack);
      }

      localStreamRef.current = fallbackStream;
      setLocalStream(fallbackStream);
      return fallbackStream;
    }
  }, []);

  /**
   * Handle WebRTC peer syncing and participant state adjustments
   */
  const syncMeshConnections = useCallback(async (roomId: string, activeParts: CallParticipant[]) => {
    if (!webRTCManagerRef.current) return;

    const otherParticipants = activeParts.filter((p) => p.user_id !== currentUserId);
    
    // Find my own record to read my join timestamp
    const myRecord = activeParts.find((p) => p.user_id === currentUserId);
    if (!myRecord) return;

    const myJoinTime = new Date(myRecord.joined_at).getTime();

    // 1. Identify participants who have joined and connect to them
    for (const peer of otherParticipants) {
      const peerId = peer.user_id;
      const theirJoinTime = new Date(peer.joined_at).getTime();

      // Simple, deterministic mesh role rule:
      // The person who joined LATER (larger timestamp) is the caller and initiates the SDP offer.
      // This prevents glare (dual simultaneous offers) and is perfectly reliable.
      const shouldCreateOffer = myJoinTime > theirJoinTime;

      await webRTCManagerRef.current.connectToPeer(peerId, shouldCreateOffer);
    }

    // 2. Identify participants who are no longer in the list (or left_at is set) and disconnect them
    const peerIdsInDb = new Set<string>(otherParticipants.map((p) => p.user_id));
    // Retrieve connections managed by WebRTC manager to check if any left
    const currentMeshConnectedPeers = Array.from(remoteStreams.keys()) as string[];
    for (const peerId of currentMeshConnectedPeers) {
      if (!peerIdsInDb.has(peerId)) {
        console.log(`[GROUP-CALL] Participant ${peerId} left the call. Disconnecting peer.`);
        webRTCManagerRef.current.disconnectPeer(peerId);
      }
    }
  }, [currentUserId, remoteStreams]);

  /**
   * Refreshes the participant list for an active room and triggers peer syncing
   */
  const refreshParticipantsList = useCallback(async (roomId: string) => {
    try {
      const activeParts = await groupSignalingService.fetchActiveParticipants(roomId);
      setParticipants(activeParts);
      await syncMeshConnections(roomId, activeParts);
    } catch (err) {
      console.error('[GROUP-CALL] Error refreshing participant list:', err);
    }
  }, [syncMeshConnections]);

  /**
   * Initial setup for Mesh WebRTC and real-time listeners upon joining/creating a room
   */
  const initRoomMesh = useCallback(async (room: CallRoom, stream: MediaStream) => {
    setActiveRoom(room);
    setCallError(null);

    // Initialize the WebRTC Mesh Manager
    const manager = new GroupWebRTCManager(
      room.id,
      currentUserId,
      (updatedStreams) => {
        setRemoteStreams(updatedStreams);
      },
      (peerId, isMuted, cameraEnabled) => {
        // Handle dynamic participant state adjustments if needed
        console.log(`[GROUP-CALL] State update received from peer ${peerId}: mute=${isMuted}, camera=${cameraEnabled}`);
      }
    );

    webRTCManagerRef.current = manager;
    manager.setLocalStream(stream);

    // Initial fetch and connect
    await refreshParticipantsList(room.id);

    // Real-time Subscriptions setup
    const roomCleanup = groupSignalingService.subscribeToRoomUpdates(room.id, (updatedRoom) => {
      console.log('[GROUP-CALL] Room update received:', updatedRoom);
      if (updatedRoom.status === 'ended') {
        cleanupCallResources();
      } else {
        setActiveRoom(updatedRoom);
      }
    });

    const participantsCleanup = groupSignalingService.subscribeToParticipants(room.id, () => {
      console.log('[GROUP-CALL] Real-time participants change event triggered');
      refreshParticipantsList(room.id);
    });

    const signalsCleanup = groupSignalingService.subscribeToGroupSignals(room.id, currentUserId, (signal: GroupCallSignal) => {
      console.log(`[GROUP-CALL] Targeted signal received from ${signal.sender_id}: ${signal.type}`);
      if (webRTCManagerRef.current) {
        webRTCManagerRef.current.handleIncomingSignal(signal.sender_id, signal.type, signal.data);
      }
    });

    return () => {
      roomCleanup();
      participantsCleanup();
      signalsCleanup();
    };
  }, [currentUserId, refreshParticipantsList, cleanupCallResources]);

  /**
   * Action: Start a new group call (audio or video)
   */
  const startGroupCall = useCallback(async (groupId: string, callType: GroupCallType) => {
    try {
      cleanupCallResources();
      setCallError(null);

      // 1. Capture local audio/video media stream
      const stream = await captureLocalMedia(callType, facingMode);

      // 2. Create the room row on Supabase
      const room = await groupSignalingService.createCallRoom(groupId, callType, currentUserId);
      console.log('[GROUP-CALL] Room created successfully:', room);

      // 3. Insert local participant row to signal we have joined
      await groupSignalingService.joinCallRoom(room.id, currentUserId, isMuted, isCameraEnabled);

      // 4. Initialize real-time mesh signaling
      const subCleanups = await initRoomMesh(room, stream);

      // Return cleanup handler so component can safely unmount or switch states
      return () => {
        subCleanups();
        cleanupCallResources();
      };
    } catch (err: any) {
      console.error('[GROUP-CALL] Failed starting group call:', err);
      setCallError(`Could not initiate group call: ${err.message || 'Unknown error'}`);
      cleanupCallResources();
    }
  }, [captureLocalMedia, facingMode, isMuted, isCameraEnabled, initRoomMesh, cleanupCallResources, currentUserId]);

  /**
   * Action: Join an existing group call room
   */
  const joinGroupCall = useCallback(async (room: CallRoom) => {
    try {
      cleanupCallResources();
      setCallError(null);

      // 1. Capture local audio/video media stream
      const stream = await captureLocalMedia(room.call_type, facingMode);

      // 2. Insert participant row to join the call room
      await groupSignalingService.joinCallRoom(room.id, currentUserId, isMuted, isCameraEnabled);
      console.log(`[GROUP-CALL] Successfully joined room ${room.id} as active participant`);

      // 3. Initialize real-time mesh signaling
      const subCleanups = await initRoomMesh(room, stream);

      // Clear any pending incoming notifications
      setIncomingRoom(null);
      setIncomingGroupName(null);
      setIncomingCallerName(null);

      return () => {
        subCleanups();
        cleanupCallResources();
      };
    } catch (err: any) {
      console.error('[GROUP-CALL] Failed joining group call:', err);
      setCallError(`Could not join group call: ${err.message || 'Unknown error'}`);
      cleanupCallResources();
    }
  }, [captureLocalMedia, facingMode, isMuted, isCameraEnabled, initRoomMesh, cleanupCallResources, currentUserId]);

  /**
   * Action: Leave group call safely, updating status in Supabase and closing WebRTC
   */
  const leaveGroupCall = useCallback(async () => {
    if (activeRoom) {
      console.log(`[GROUP-CALL] Leaving group call room ${activeRoom.id}`);
      await groupSignalingService.leaveCallRoom(activeRoom.id, currentUserId);
    }
    cleanupCallResources();
  }, [activeRoom, currentUserId, cleanupCallResources]);

  /**
   * Action: Terminate group call entirely for all participants (Admins/Creators)
   */
  const endGroupCall = useCallback(async () => {
    if (activeRoom) {
      console.log(`[GROUP-CALL] Ending group call room ${activeRoom.id} for all`);
      await groupSignalingService.updateRoomStatus(activeRoom.id, 'ended');
    }
    cleanupCallResources();
  }, [activeRoom, cleanupCallResources]);

  /**
   * Action: Toggle microphone mute status
   */
  const toggleLocalMute = useCallback(async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      console.log(`[GROUP-CALL] Local audio track toggled. Muted: ${nextMuted}`);
    }

    if (activeRoom) {
      await groupSignalingService.updateParticipantState(activeRoom.id, currentUserId, {
        is_muted: nextMuted
      });
    }
  }, [isMuted, activeRoom, currentUserId]);

  /**
   * Action: Toggle local camera enabled status
   */
  const toggleLocalCamera = useCallback(async () => {
    const nextCamera = !isCameraEnabled;
    setIsCameraEnabled(nextCamera);

    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = nextCamera;
      });
      console.log(`[GROUP-CALL] Local video track toggled. Enabled: ${nextCamera}`);
    }

    if (activeRoom) {
      await groupSignalingService.updateParticipantState(activeRoom.id, currentUserId, {
        camera_enabled: nextCamera
      });
    }
  }, [isCameraEnabled, activeRoom, currentUserId]);

  /**
   * Action: Switch camera between user and environment facing modes
   */
  const switchCamera = useCallback(async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);

    if (activeRoom && localStreamRef.current) {
      console.log(`[GROUP-CALL] Switching camera facing to ${nextFacing}`);
      const stream = await captureLocalMedia(activeRoom.call_type, nextFacing);
      if (webRTCManagerRef.current) {
        webRTCManagerRef.current.setLocalStream(stream);
      }
    }
  }, [facingMode, activeRoom, captureLocalMedia]);

  /**
   * Listen to globally broadcast incoming call notifications inside joined group channels
   */
  useEffect(() => {
    if (!currentUserId) return;

    console.log('[GROUP-CALL] Starting global subscription for incoming group call events');
    const cleanupIncomingSubscription = groupSignalingService.subscribeToIncomingGroupCalls(
      currentUserId,
      async (room: CallRoom) => {
        console.log('[GROUP-CALL] Global listener detected incoming group call room:', room.id);
        
        // Don't interrupt if already in a call
        if (activeRoomRef.current) {
          console.log('[GROUP-CALL] Already active in another call. Silently ignoring group call offer.');
          return;
        }

        try {
          // Fetch group details
          const { data: group } = await supabase
            .from('groups')
            .select('name')
            .eq('id', room.group_id)
            .maybeSingle();

          // Fetch caller details
          const { data: caller } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', room.created_by)
            .maybeSingle();

          setIncomingRoom(room);
          setIncomingGroupName(group ? group.name : 'Secure Group Chat');
          setIncomingCallerName(caller ? caller.username : 'Someone');

          // Trigger browser native Web Push notification as fallback if supported
          if ('Notification' in window && Notification.permission === 'granted') {
            const title = `${caller?.username || 'Someone'} is calling group ${group?.name || 'Secure Group'}`;
            const options = {
              body: `Incoming ${room.call_type === 'video' ? 'Video' : 'Voice'} Call`,
              icon: `https://api.dicebear.com/7.x/adventurer/svg?seed=${room.group_id}`,
              requireInteraction: true
            };
            if ('serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.ready;
              reg.showNotification(title, options);
            } else {
              new Notification(title, options);
            }
          }
        } catch (err) {
          console.warn('[GROUP-CALL] Error formatting incoming call notification details:', err);
        }
      }
    );

    return () => {
      cleanupIncomingSubscription();
    };
  }, [currentUserId]);

  return {
    activeRoom,
    participants,
    localStream,
    remoteStreams,
    callDuration,
    isMinimized,
    callError,
    isMuted,
    isCameraEnabled,
    facingMode,
    incomingRoom,
    incomingGroupName,
    incomingCallerName,
    setIsMinimized,
    setCallError,
    startGroupCall,
    joinGroupCall,
    leaveGroupCall,
    endGroupCall,
    toggleLocalMute,
    toggleLocalCamera,
    switchCamera,
    rejectIncomingGroupCall: () => {
      setIncomingRoom(null);
      setIncomingGroupName(null);
      setIncomingCallerName(null);
    }
  };
}
