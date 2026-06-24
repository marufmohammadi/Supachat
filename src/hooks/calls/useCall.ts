import { useState, useEffect, useRef, useCallback } from 'react';
import { signalingService } from '../../services/signaling';
import { Call, CallSignal, CallStatus, CallType, Profile } from '../../types/calls';
import { supabase } from '../../lib/supabase';
import { OneToOneWebRTCManager } from '../../services/webrtc/one-to-one';

// Helper to create simulated media stream when hardware/permission is missing or denied
function createMockMediaStream(video: boolean): MediaStream {
  const tracks: MediaStreamTrack[] = [];

  // Create mock audio track
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.connect(dest);
      osc.start();
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) {
        tracks.push(audioTrack);
      }
    }
  } catch (e) {
    console.warn('[CALLS] Failed to create mock audio track:', e);
  }

  // Create mock video track
  if (video) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#10b981';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Simulated Camera Active', 320, 240);
      }
      
      let frame = 0;
      const interval = setInterval(() => {
        if (!canvas) {
          clearInterval(interval);
          return;
        }
        const ctx2 = canvas.getContext('2d');
        if (ctx2) {
          ctx2.fillStyle = '#0f172a';
          ctx2.fillRect(0, 0, canvas.width, canvas.height);
          ctx2.fillStyle = '#10b981';
          ctx2.font = '24px sans-serif';
          ctx2.textAlign = 'center';
          ctx2.fillText(`Simulated Camera Feed (${frame++})`, 320, 200);
          
          // Draw a pulsing circle to show movement
          ctx2.beginPath();
          ctx2.arc(320, 280, 40 + Math.sin(frame * 0.1) * 15, 0, Math.PI * 2);
          ctx2.fillStyle = '#3b82f6';
          ctx2.fill();
        }
      }, 100);

      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          tracks.push(videoTrack);
        }
      }
    } catch (e) {
      console.warn('[CALLS] Failed to create mock video track:', e);
    }
  }

  return new MediaStream(tracks);
}

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
  const oneToOneWebRTCManagerRef = useRef<OneToOneWebRTCManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const signalingCleanupRef = useRef<(() => void) | null>(null);
  const callUpdatesCleanupRef = useRef<(() => void) | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isBusyRef = useRef<boolean>(false);
  const iceCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const processedSignalsRef = useRef<Set<string>>(new Set());

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
    if (oneToOneWebRTCManagerRef.current) {
      oneToOneWebRTCManagerRef.current.destroy();
      oneToOneWebRTCManagerRef.current = null;
    }
    pcRef.current = null;

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
    iceCandidatesQueueRef.current = [];
    processedSignalsRef.current.clear();
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
   * Handle WebRTC connection state failures / reconnections
   */
  const handleIceConnectionFailure = useCallback(async () => {
    if (pcRef.current && callRole === 'caller' && activeCall) {
      console.warn('[CALLS] ICE connection failed/disconnected. Initiating ICE restart...');
      try {
        const offer = await pcRef.current.createOffer({ iceRestart: true });
        await pcRef.current.setLocalDescription(offer);
        await signalingService.sendSignal(activeCall.id, currentUserId, 'offer', offer);
        console.log('[CALLS] ICE restart offer sent successfully');
      } catch (err) {
        console.error('[CALLS] Failed to create ICE restart offer:', err);
      }
    }
  }, [callRole, activeCall, currentUserId]);

  /**
   * Set up WebRTC connection object
   */
  const setupPeerConnection = useCallback((callObj: Call, stream: MediaStream) => {
    console.log('[CALLS] Setting up RTCPeerConnection via OneToOneWebRTCManager');
    
    const rtcManager = new OneToOneWebRTCManager(
      callObj.id,
      currentUserId,
      (remoteStreamObj) => {
        setRemoteStream(remoteStreamObj);
      },
      (candidateJson) => {
        signalingService.sendSignal(
          callObj.id,
          currentUserId,
          'candidate',
          candidateJson
        ).catch((err) => {
          console.error('[CALLS] Failed sending ICE candidate signal:', err);
        });
      },
      () => {
        handleIceConnectionFailure();
      }
    );
    
    oneToOneWebRTCManagerRef.current = rtcManager;
    const pc = rtcManager.initialize(stream);
    pcRef.current = pc;
    
    return pc;
  }, [currentUserId, handleIceConnectionFailure]);

  /**
   * Handle WebRTC signal messages received during call setup
   */
  const handleIncomingSignal = useCallback(async (callObj: Call, signal: CallSignal) => {
    // Ignore signals sent by myself
    if (signal.sender_id === currentUserId) return;

    // Filter out already processed signals (crucial for catch-up/historical signals fetch)
    if (signal.id) {
      if (processedSignalsRef.current.has(signal.id)) {
        return;
      }
      processedSignalsRef.current.add(signal.id);
    }

    console.log(`[CALLS] Processing incoming signal [${signal.type}] from peer:`, signal.sender_id);

    try {
      if (signal.type === 'offer') {
        if (!pcRef.current) {
          console.warn('[CALLS] Received offer but connection is not ready yet');
          return;
        }
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal.data));
        console.log('[CALLS] Remote SDP Offer applied successfully');

        // Apply any queued ICE candidates received before the offer was processed
        if (iceCandidatesQueueRef.current.length > 0) {
          console.log(`[CALLS] Applying ${iceCandidatesQueueRef.current.length} queued ICE candidates after offer`);
          while (iceCandidatesQueueRef.current.length > 0) {
            const candidate = iceCandidatesQueueRef.current.shift();
            if (candidate) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
                console.warn('[CALLS] Error adding queued ICE candidate:', err);
              });
            }
          }
        }

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

          // Apply any queued ICE candidates received before the answer was processed
          if (iceCandidatesQueueRef.current.length > 0) {
            console.log(`[CALLS] Applying ${iceCandidatesQueueRef.current.length} queued ICE candidates after answer`);
            while (iceCandidatesQueueRef.current.length > 0) {
              const candidate = iceCandidatesQueueRef.current.shift();
              if (candidate) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
                  console.warn('[CALLS] Error adding queued ICE candidate:', err);
                });
              }
            }
          }
        }
      } 
      else if (signal.type === 'candidate') {
        if (pcRef.current && pcRef.current.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.data));
          console.log('[CALLS] ICE Candidate added successfully');
        } else {
          console.log('[CALLS] Queueing ICE candidate because remote description is not yet applied');
          iceCandidatesQueueRef.current.push(signal.data);
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
      console.log('[CALLS] getUserMedia successful in startCall:', {
        localStream: mediaStream,
        audioTracksCount: mediaStream.getAudioTracks().length,
        videoTracksCount: mediaStream.getVideoTracks().length
      });
    } catch (err) {
      console.warn('[CALLS] Media device access denied. Falling back to simulated media stream:', err);
      // Fallback to simulated media stream
      mediaStream = createMockMediaStream(callType === 'video');
      localStreamRef.current = mediaStream;
      setLocalStream(mediaStream);
      
      setCallError('Notice: Device permissions denied. Running in Simulated Media mode for local testing.');
      setTimeout(() => {
        setCallError(null);
      }, 4000);
    }

    try {
      // 2. Create Call entry in Supabase with status 'ringing'
      const callObj = await signalingService.createCall(currentUserId, receiverProfile.id, callType);
      setActiveCall(callObj);

      // 2.5 Fetch recipient's push token and log sending push notification automatically
      try {
        const recipientToken = await signalingService.getPushToken(receiverProfile.id);
        if (recipientToken) {
          console.log(`[PUSH] Automatically sending Web Push notification payload to token [${recipientToken}] for call ${callObj.id}`);
        } else {
          console.log('[PUSH] Recipient has no registered push token yet.');
        }
      } catch (pushErr) {
        console.warn('[PUSH] Failed to fetch recipient push token:', pushErr);
      }

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

      // Fetch any pre-existing signals (SDP offer/candidates) to ensure no signal is missed due to subscription latency
      signalingService.fetchSignals(callObj.id).then((signals) => {
        console.log(`[CALLS] Caller catch-up fetched ${signals.length} signals`);
        signals.forEach((sig) => {
          handleIncomingSignal(callObj, sig);
        });
      });

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
      console.log('[CALLS] getUserMedia successful in acceptCall:', {
        localStream: mediaStream,
        audioTracksCount: mediaStream.getAudioTracks().length,
        videoTracksCount: mediaStream.getVideoTracks().length
      });
    } catch (err) {
      console.warn('[CALLS] Media device access denied during accept. Falling back to simulated media stream:', err);
      // Fallback to simulated media stream
      mediaStream = createMockMediaStream(activeCall.call_type === 'video');
      localStreamRef.current = mediaStream;
      setLocalStream(mediaStream);
      
      setCallError('Notice: Device permissions denied. Running in Simulated Media mode for local testing.');
      setTimeout(() => {
        setCallError(null);
      }, 4000);
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

      // Fetch any pre-existing signals (SDP offer/candidates) to ensure no signal is missed due to subscription latency
      signalingService.fetchSignals(updatedCall.id).then((signals) => {
        console.log(`[CALLS] Receiver catch-up fetched ${signals.length} signals`);
        signals.forEach((sig) => {
          handleIncomingSignal(updatedCall, sig);
        });
      });

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
   * Triggers a native system push notification for incoming calls
   */
  const triggerCallPushNotification = useCallback(async (incomingCall: Call, callerName: string) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      console.log('[PUSH] Notifications not granted or supported, skipping push notification');
      return;
    }

    console.log('[PUSH] Displaying native push notification for incoming call:', incomingCall.id);
    const title = `${callerName || 'Someone'} is calling you`;
    const options: any = {
      body: `Incoming ${incomingCall.call_type === 'video' ? 'Video' : 'Voice'} Call`,
      icon: `https://api.dicebear.com/7.x/adventurer/svg?seed=${incomingCall.caller_id}`,
      badge: `https://api.dicebear.com/7.x/adventurer/svg?seed=${incomingCall.caller_id}`,
      tag: `call-${incomingCall.id}`,
      requireInteraction: true,
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'reject', title: 'Reject' }
      ]
    };

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
        console.log('[PUSH] Native call notification displayed via Service Worker');
      } catch (err) {
        console.warn('[PUSH] Service Worker not ready for notification, falling back to window Notification', err);
        new Notification(title, options);
      }
    } else {
      new Notification(title, options);
    }
  }, []);

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
        triggerCallPushNotification(incomingCall, data.username);
      } else {
        const fallbackName = 'Unknown Caller';
        setOtherPartyProfile({
          id: incomingCall.caller_id,
          username: fallbackName
        });
        triggerCallPushNotification(incomingCall, fallbackName);
      }
    } catch (err) {
      console.error('[CALLS] Error fetching caller profile:', err);
      triggerCallPushNotification(incomingCall, 'Unknown Caller');
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

  }, [cleanupCallResources, loadCallHistory, triggerCallPushNotification]);

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

  // Store and register device push tokens in Supabase
  useEffect(() => {
    if (!currentUserId) return;

    const registerToken = async () => {
      try {
        let token = localStorage.getItem('web_push_token');
        if (!token) {
          token = 'web-token-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
          localStorage.setItem('web_push_token', token);
        }
        await signalingService.registerPushToken(currentUserId, token);
      } catch (err) {
        console.warn('[PUSH] Failed to register push token:', err);
      }
    };

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        registerToken();
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            registerToken();
          }
        });
      }
    }
  }, [currentUserId]);

  // Register message listener from Service Worker for background Actions
  useEffect(() => {
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'CALL_ACTION') {
        const { action, callId } = event.data;
        console.log(`[PUSH] Call action postMessage received from Service Worker: ${action} for call ${callId}`);
        if (action === 'accept') {
          acceptCall();
        } else if (action === 'reject') {
          rejectCall();
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [acceptCall, rejectCall]);

  // Parse URL query parameters for actions on start if opened from notification click
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const callId = params.get('callId');
    if (action && callId) {
      console.log(`[PUSH] URL action parsed from query parameter: ${action} for call ${callId}`);
      // Clean query params so they don't trigger repeatedly on reload
      window.history.replaceState({}, document.title, window.location.pathname);
      
      if (action === 'accept') {
        acceptCall();
      } else if (action === 'reject') {
        rejectCall();
      }
    }
  }, [acceptCall, rejectCall]);

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
