import { useState, useEffect, useRef, useCallback } from 'react';
import { signalingService } from '../../services/signaling';
import { Call, CallSignal, CallStatus, CallType, Profile } from '../../types/calls';
import { supabase } from '../../lib/supabase';

interface UseCallProps {
  currentUserId: string;
  currentUserProfile?: Profile;
}

export function useCall({ currentUserId, currentUserProfile }: UseCallProps) {
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callRole, setCallRole] = useState<'caller' | 'receiver' | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  // Call Controls State
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isSpeakerMode, setIsSpeakerMode] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // UX State
  const [callDuration, setCallDuration] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const [otherPartyProfile, setOtherPartyProfile] = useState<Profile | null>(null);
  const [callHistory, setCallHistory] = useState<any[]>([]);

  // WebRTC & Subscriptions Refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const signalingCleanupRef = useRef<(() => void) | null>(null);
  const callUpdatesCleanupRef = useRef<(() => void) | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isBusyRef = useRef<boolean>(false);

  // Keep busy state in sync
  useEffect(() => {
    isBusyRef.current = !!activeCall && activeCall.status !== 'ended' && activeCall.status !== 'rejected' && activeCall.status !== 'missed' && activeCall.status !== 'busy';
  }, [activeCall]);

  /**
   * Refetch call logs history
   */
  const loadCallHistory = useCallback(async () => {
    if (!currentUserId) return;
    const logs = await signalingService.fetchCallLogs(currentUserId);
    setCallHistory(logs);
  }, [currentUserId]);

  useEffect(() => {
    loadCallHistory();
  }, [loadCallHistory]);

  /**
   * Clean up WebRTC peer connection and media tracks
   */
  const cleanupCallResources = useCallback(() => {
    console.log('[CALLS] Cleaning up call resources');
    
    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop all media tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log(`[CALLS] Stopped track: ${track.kind}`);
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);

    // Close WebRTC Peer Connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Unsubscribe from real-time events
    if (signalingCleanupRef.current) {
      signalingCleanupRef.current();
      signalingCleanupRef.current = null;
    }
    if (callUpdatesCleanupRef.current) {
      callUpdatesCleanupRef.current();
      callUpdatesCleanupRef.current = null;
    }

    setCallRole(null);
    setOtherPartyProfile(null);
    setIsMuted(false);
    setIsCameraEnabled(true);
  }, []);

  /**
   * Safe End Call logic: Updates state and saves call logs
   */
  const endCall = useCallback(async (customStatus?: CallStatus) => {
    if (!activeCall) return;

    const finalStatus = customStatus || (activeCall.status === 'accepted' ? 'ended' : 'missed');
    const duration = callDuration;
    
    console.log(`[CALLS] Ending call ${activeCall.id} with status ${finalStatus}, duration ${duration}`);
    
    try {
      // Send a hangup signal so other end knows instantly if they haven't received the table update
      if (activeCall.status === 'accepted') {
        await signalingService.sendSignal(activeCall.id, currentUserId, 'hangup', { reason: 'user_ended' }).catch(() => {});
      }

      // Update calls table status
      await signalingService.updateCallStatus(activeCall.id, finalStatus, {
        ended_at: new Date().toISOString(),
        duration
      });

      // Write into the permanent call logs
      await signalingService.logCall(
        activeCall.caller_id,
        activeCall.receiver_id,
        activeCall.call_type,
        finalStatus,
        duration
      );
    } catch (err) {
      console.error('[CALLS] Error during call termination database update:', err);
    } finally {
      cleanupCallResources();
      setActiveCall(null);
      loadCallHistory();
    }
  }, [activeCall, callDuration, currentUserId, cleanupCallResources, loadCallHistory]);

  /**
   * Toggle local microphone audio track
   */
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
        console.log(`[CALLS] Audio track enabled: ${track.enabled}`);
      });
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  /**
   * Toggle local video track
   */
  const toggleCamera = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !track.enabled;
        console.log(`[CALLS] Video track enabled: ${track.enabled}`);
      });
      setIsCameraEnabled(!isCameraEnabled);
    }
  }, [isCameraEnabled]);

  /**
   * Switch between front and back camera (facing mode)
   */
  const switchCamera = useCallback(async () => {
    if (!localStream || !activeCall || activeCall.call_type !== 'video') return;

    try {
      const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
      console.log(`[CALLS] Switching camera facing mode to: ${newFacingMode}`);
      
      // Stop old video tracks
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach((track) => track.stop());

      // Get new video stream
      const constraints = {
        audio: false,
        video: { facingMode: newFacingMode }
      };
      
      const newVideoStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newVideoStream.getVideoTracks()[0];

      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          console.log('[CALLS] Successfully replaced WebRTC video sender track');
        }
      }

      // Merge new video track into localStream
      const audioTrack = localStream.getAudioTracks()[0];
      const newStream = new MediaStream([newVideoTrack]);
      if (audioTrack) {
        newStream.addTrack(audioTrack);
      }

      localStreamRef.current = newStream;
      setLocalStream(newStream);
      setFacingMode(newFacingMode);
    } catch (err) {
      console.error('[CALLS] Error switching camera:', err);
      setCallError('Failed to switch camera source');
    }
  }, [localStream, activeCall, facingMode]);

  /**
   * Set up WebRTC connection object
   */
  const setupPeerConnection = useCallback((callObj: Call, stream: MediaStream) => {
    console.log('[CALLS] Setting up RTCPeerConnection');
    
    // Config includes Google STUN server and allows for easy future configuration
    const pcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
        // Future TURN servers can be securely added here
      ]
    };

    const pc = new RTCPeerConnection(pcConfig);
    pcRef.current = pc;

    // Add local tracks to peer connection
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
      console.log(`[CALLS] Added track to connection: ${track.kind}`);
    });

    // Handle incoming remote media tracks
    pc.ontrack = (event) => {
      console.log('[CALLS] Received remote media track');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else {
        // Fallback if no streams provided with track
        const incomingStream = new MediaStream([event.track]);
        setRemoteStream(incomingStream);
      }
    };

    // Handle ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[CALLS] Generated ICE Candidate, sending to peer');
        signalingService.sendSignal(
          callObj.id,
          currentUserId,
          'candidate',
          event.candidate.toJSON()
        ).catch((err) => {
          console.error('[CALLS] Failed sending ICE candidate signal:', err);
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[CALLS] ICE Connection State changed:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('[CALLS] Peer connection lost/failed');
        // Do not end call immediately, let candidate retry, or end on prolonged disconnect
      }
    };

    return pc;
  }, [currentUserId]);

  /**
   * Handle WebRTC signal messages received during call setup
   */
  const handleIncomingSignal = useCallback(async (callObj: Call, signal: CallSignal) => {
    // Ignore signals sent by myself
    if (signal.sender_id === currentUserId) return;

    console.log(`[CALLS] Processing incoming signal [${signal.type}] from peer:`, signal.sender_id);

    try {
      if (signal.type === 'offer') {
        if (!pcRef.current) {
          console.warn('[CALLS] Received offer but connection is not ready yet');
          return;
        }
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal.data));
        console.log('[CALLS] Remote SDP Offer applied successfully');

        // Create SDP Answer
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        console.log('[CALLS] Local SDP Answer created and set');

        // Send Answer back
        await signalingService.sendSignal(callObj.id, currentUserId, 'answer', answer);
      } 
      else if (signal.type === 'answer') {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal.data));
          console.log('[CALLS] Remote SDP Answer applied successfully');
        }
      } 
      else if (signal.type === 'candidate') {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.data));
          console.log('[CALLS] ICE Candidate added successfully');
        }
      } 
      else if (signal.type === 'hangup') {
        console.log('[CALLS] Peer ended call via signal');
        cleanupCallResources();
        setActiveCall(null);
        loadCallHistory();
      }
    } catch (err) {
      console.error('[CALLS] Error handling signal:', err);
      setCallError('WebRTC signaling or connection setup failed');
    }
  }, [currentUserId, cleanupCallResources, loadCallHistory]);

  /**
   * Initiates an outgoing call to a specific contact profile
   */
  const startCall = useCallback(async (receiverProfile: Profile, callType: CallType) => {
    if (isBusyRef.current) {
      setCallError('You are already in an active call');
      return;
    }

    console.log(`[CALLS] Starting outgoing ${callType} call to user:`, receiverProfile.username);
    setCallError(null);
    setOtherPartyProfile(receiverProfile);
    setCallRole('caller');
    setCallDuration(0);

    let mediaStream: MediaStream | null = null;
    try {
      // 1. Get media devices permissions
      const constraints = {
        audio: true,
        video: callType === 'video' ? { facingMode: 'user' } : false
      };
      
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = mediaStream;
      setLocalStream(mediaStream);
    } catch (err) {
      console.error('[CALLS] Media device access denied:', err);
      setCallError(callType === 'video' 
        ? 'Camera or microphone access denied. Please enable them to place a video call.' 
        : 'Microphone access denied. Please enable it to place a voice call.'
      );
      setCallRole(null);
      setOtherPartyProfile(null);
      return;
    }

    try {
      // 2. Create Call entry in Supabase with status 'ringing'
      const callObj = await signalingService.createCall(currentUserId, receiverProfile.id, callType);
      setActiveCall(callObj);

      // 3. Initialize RTCPeerConnection & send Offer
      const pc = setupPeerConnection(callObj, mediaStream);
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[CALLS] Created and saved local offer description');

      // Send the offer signaling message
      await signalingService.sendSignal(callObj.id, currentUserId, 'offer', offer);

      // 4. Subscribe to Real-time updates for call state (e.g. accepted, rejected, busy)
      const callUpdatesCleanup = signalingService.subscribeToCallUpdates(callObj.id, (updatedCall) => {
        console.log('[CALLS] Real-time Call Update received:', updatedCall.status);
        
        setActiveCall(updatedCall);

        if (updatedCall.status === 'accepted') {
          console.log('[CALLS] Call was ACCEPTED by peer. Starting duration timer...');
          // Start call duration counter
          if (!durationIntervalRef.current) {
            durationIntervalRef.current = setInterval(() => {
              setCallDuration((prev) => prev + 1);
            }, 1000);
          }
        } 
        else if (updatedCall.status === 'rejected') {
          console.log('[CALLS] Call was REJECTED by peer');
          setCallError('Call rejected by recipient');
          cleanupCallResources();
          setActiveCall(null);
          loadCallHistory();
        } 
        else if (updatedCall.status === 'busy') {
          console.log('[CALLS] User is busy in another call');
          setCallError('Recipient is currently busy on another call');
          cleanupCallResources();
          setActiveCall(null);
          loadCallHistory();
        } 
        else if (updatedCall.status === 'ended') {
          console.log('[CALLS] Call ended by recipient');
          cleanupCallResources();
          setActiveCall(null);
          loadCallHistory();
        }
      });
      callUpdatesCleanupRef.current = callUpdatesCleanup;

      // 5. Subscribe to WebRTC signals
      const signalsCleanup = signalingService.subscribeToSignals(callObj.id, (signal) => {
        handleIncomingSignal(callObj, signal);
      });
      signalingCleanupRef.current = signalsCleanup;

    } catch (err: any) {
      console.error('[CALLS] Outgoing call flow failed:', err);
      setCallError(`Call failed: ${err.message || 'unknown error'}`);
      cleanupCallResources();
      setActiveCall(null);
    }
  }, [currentUserId, setupPeerConnection, handleIncomingSignal, cleanupCallResources, loadCallHistory]);

  /**
   * Accepts an incoming call
   */
  const acceptCall = useCallback(async () => {
    if (!activeCall || callRole !== 'receiver') return;

    console.log('[CALLS] Accepting incoming call:', activeCall.id);
    setCallError(null);

    let mediaStream: MediaStream | null = null;
    try {
      // 1. Get media devices permissions
      const constraints = {
        audio: true,
        video: activeCall.call_type === 'video' ? { facingMode: 'user' } : false
      };
      
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = mediaStream;
      setLocalStream(mediaStream);
    } catch (err) {
      console.error('[CALLS] Media device access denied during accept:', err);
      setCallError('Camera or microphone permission was denied.');
      // Update status to rejected/failed so caller knows
      await endCall('rejected');
      return;
    }

    try {
      // 2. Update status in database to 'accepted'
      const updatedCall = await signalingService.updateCallStatus(activeCall.id, 'accepted', {
        started_at: new Date().toISOString()
      });
      setActiveCall(updatedCall);

      // Start duration timer
      if (!durationIntervalRef.current) {
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      }

      // 3. Set up Peer Connection
      const pc = setupPeerConnection(updatedCall, mediaStream);

      // 4. Subscribe to signals to process SDP Offer & answer exchange
      const signalsCleanup = signalingService.subscribeToSignals(updatedCall.id, (signal) => {
        handleIncomingSignal(updatedCall, signal);
      });
      signalingCleanupRef.current = signalsCleanup;

    } catch (err) {
      console.error('[CALLS] Failed during call acceptance:', err);
      setCallError('Could not establish media connection');
      cleanupCallResources();
      setActiveCall(null);
    }
  }, [activeCall, callRole, setupPeerConnection, handleIncomingSignal, endCall, cleanupCallResources]);

  /**
   * Rejects an incoming call
   */
  const rejectCall = useCallback(async () => {
    if (!activeCall || callRole !== 'receiver') return;

    console.log('[CALLS] Rejecting incoming call:', activeCall.id);
    await endCall('rejected');
  }, [activeCall, callRole, endCall]);

  /**
   * Handles incoming call signals triggered via global subscription
   */
  const receiveIncomingCall = useCallback(async (incomingCall: Call) => {
    // If already in a call, reject incoming call as "busy"
    if (isBusyRef.current) {
      console.log(`[CALLS] Busy. Auto-rejecting incoming call ${incomingCall.id} as busy`);
      await signalingService.updateCallStatus(incomingCall.id, 'busy').catch(() => {});
      await signalingService.logCall(
        incomingCall.caller_id,
        incomingCall.receiver_id,
        incomingCall.call_type,
        'busy',
        0
      ).catch(() => {});
      return;
    }

    console.log('[CALLS] Receiving incoming call event:', incomingCall);
    setActiveCall(incomingCall);
    setCallRole('receiver');
    setCallDuration(0);
    setCallError(null);

    // Fetch caller profile information
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .eq('id', incomingCall.caller_id)
        .single();
      if (!error && data) {
        setOtherPartyProfile(data as Profile);
      } else {
        setOtherPartyProfile({
          id: incomingCall.caller_id,
          username: 'Unknown Caller'
        });
      }
    } catch (err) {
      console.error('[CALLS] Error fetching caller profile:', err);
    }

    // Subscribe to call updates to watch if caller cancels or hangs up
    const callUpdatesCleanup = signalingService.subscribeToCallUpdates(incomingCall.id, (updatedCall) => {
      console.log('[CALLS] Incoming Call state updated in DB:', updatedCall.status);
      setActiveCall(updatedCall);

      if (updatedCall.status === 'ended' || updatedCall.status === 'rejected') {
        console.log('[CALLS] Call cancelled by caller or ended');
        cleanupCallResources();
        setActiveCall(null);
        loadCallHistory();
      }
    });
    callUpdatesCleanupRef.current = callUpdatesCleanup;

  }, [cleanupCallResources, loadCallHistory]);

  // Subscribe to globally dispatched incoming call triggers
  useEffect(() => {
    if (!currentUserId) return;

    console.log(`[CALLS] Listening for incoming call invites for user ${currentUserId}`);
    const unsubscribe = signalingService.subscribeToIncomingCalls(currentUserId, (incomingCall) => {
      receiveIncomingCall(incomingCall);
    });

    return () => {
      unsubscribe();
    };
  }, [currentUserId, receiveIncomingCall]);

  // Handle browser window unload safely
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isBusyRef.current) {
        endCall('ended');
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [endCall]);

  return {
    activeCall,
    callRole,
    localStream,
    remoteStream,
    isMuted,
    isCameraEnabled,
    isSpeakerMode,
    callDuration,
    callError,
    otherPartyProfile,
    callHistory,
    setCallError,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    setIsSpeakerMode,
    loadCallHistory
  };
}
