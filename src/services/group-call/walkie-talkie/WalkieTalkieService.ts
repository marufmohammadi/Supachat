import { supabase } from '../../../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface WalkieTalkieParticipant {
  userId: string;
  username: string;
  avatarSeed: string;
  role: 'owner' | 'admin' | 'member';
  isSpeaking: boolean;
  isMuted: boolean; // Admin force-muted
  isMutedLocal: boolean; // Self muted
  joinedAt: string;
  connectionState?: RTCPeerConnectionState;
}

export interface WalkieTalkieCallbacks {
  onParticipantsChanged: (participants: WalkieTalkieParticipant[]) => void;
  onRemoteStreamsChanged: (streams: Map<string, MediaStream>) => void;
  onSpeakingStateChanged: (userId: string, isSpeaking: boolean) => void;
  onKicked: () => void;
  onForceMuted: () => void;
  onRoomLockChanged: (locked: boolean) => void;
  onConnectionQualityChanged: (quality: 'excellent' | 'good' | 'poor' | 'connecting') => void;
}

export class GroupWalkieTalkieManager {
  private groupId: string;
  private roomId: string;
  private currentUserId: string;
  private currentUsername: string;
  private currentUserRole: 'owner' | 'admin' | 'member' = 'member';
  private callbacks: WalkieTalkieCallbacks;

  private channel: RealtimeChannel | null = null;
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  private participants: Map<string, WalkieTalkieParticipant> = new Map();
  private iceCandidatesQueues: Map<string, any[]> = new Map();

  // State
  private isSpeaking = false;
  private isForceMuted = false;
  private isRoomLocked = false;
  private isConnecting = true;

  constructor(
    groupId: string,
    roomId: string,
    currentUserId: string,
    currentUsername: string,
    currentUserRole: 'owner' | 'admin' | 'member',
    callbacks: WalkieTalkieCallbacks
  ) {
    this.groupId = groupId;
    this.roomId = roomId;
    this.currentUserId = currentUserId;
    this.currentUsername = currentUsername;
    this.currentUserRole = currentUserRole;
    this.callbacks = callbacks;

    console.log(`[WALKIE-TALKIE] Initializing WalkieTalkieManager for group=${groupId}, room=${roomId}, user=${currentUserId}`);
  }

  /**
   * Joins the Walkie-Talkie room
   */
  public async join() {
    this.isConnecting = true;
    this.callbacks.onConnectionQualityChanged('connecting');

    try {
      // 1. Get the local microphone audio stream
      console.log('[WALKIE-TALKIE] Requesting microphone access...');
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (mediaErr) {
        console.warn('[WALKIE-TALKIE] Microphone access denied or failed. Creating fallback simulated audio stream:', mediaErr);
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const oscillator = audioCtx.createOscillator();
          const dst = oscillator.connect(audioCtx.createMediaStreamDestination()) as any;
          oscillator.start();
          const audioTrack = dst.stream.getAudioTracks()[0];
          if (audioTrack) {
            this.localStream = new MediaStream([audioTrack]);
          }
        }
        if (!this.localStream) {
          throw mediaErr;
        }
      }

      // Ensure local microphone track is disabled (OFF) by default
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        console.log(`[WALKIE-TALKIE] Local audio track ${track.id} disabled by default`);
      });

      // 2. Setup Supabase Realtime channel for walkie-talkie
      const channelName = `group-walkie-talkie:${this.roomId}`;
      console.log(`[WALKIE-TALKIE] Connecting to realtime channel: ${channelName}`);

      // Clean up any stale channel first
      const existingChannels = supabase.getChannels();
      const match = existingChannels.find(
        (ch) => ch.topic === channelName || ch.topic === `realtime:${channelName}`
      );
      if (match) {
        console.log(`[WALKIE-TALKIE] Found existing stale channel. Removing it.`);
        await supabase.removeChannel(match);
      }

      this.channel = supabase.channel(channelName, {
        config: {
          presence: {
            key: this.currentUserId,
          },
        },
      });

      // 3. Register channel event handlers
      this.channel
        .on('presence', { event: 'sync' }, () => {
          this.handlePresenceSync();
        })
        .on('broadcast', { event: 'signal' }, (payload) => {
          this.handleSignalingEvent(payload);
        })
        .on('broadcast', { event: 'action' }, (payload) => {
          this.handleAdminActionEvent(payload);
        })
        .on('broadcast', { event: 'speaking' }, (payload) => {
          this.handleSpeakingBroadcastEvent(payload);
        })
        .on('broadcast', { event: 'request_state' }, (payload) => {
          this.handleRequestStateEvent(payload);
        })
        .on('broadcast', { event: 'sync_state' }, (payload) => {
          this.handleSyncStateEvent(payload);
        });

      // 4. Subscribe and track presence
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[WALKIE-TALKIE] Realtime channel subscribed successfully.');

          // Track our presence
          await this.channel?.track({
            userId: this.currentUserId,
            username: this.currentUsername,
            avatarSeed: this.currentUsername,
            role: this.currentUserRole,
            isSpeaking: this.isSpeaking,
            isMuted: this.isForceMuted,
            isMutedLocal: false,
            joinedAt: new Date().toISOString(),
          });

          // Request current room lock/mute state from existing participants
          this.channel?.send({
            type: 'broadcast',
            event: 'request_state',
            payload: { senderId: this.currentUserId },
          });

          this.isConnecting = false;
          this.callbacks.onConnectionQualityChanged('excellent');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[WALKIE-TALKIE] Realtime connection status:', status);
          this.callbacks.onConnectionQualityChanged('poor');
        }
      });

    } catch (err) {
      console.error('[WALKIE-TALKIE] Failed to join walkie-talkie:', err);
      this.callbacks.onConnectionQualityChanged('poor');
      throw err;
    }
  }

  /**
   * Leaves the Walkie-Talkie room and cleans up all WebRTC & media resources
   */
  public leave() {
    console.log('[WALKIE-TALKIE] Leaving room and cleaning up resources...');

    // 1. Stop local speaking if active
    if (this.isSpeaking) {
      this.stopSpeaking();
    }

    // 2. Stop local media stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
        console.log(`[WALKIE-TALKIE] Stopped local track: ${track.id}`);
      });
      this.localStream = null;
    }

    // 3. Close all peer connections
    this.peerConnections.forEach((pc, peerId) => {
      pc.close();
      console.log(`[WALKIE-TALKIE] Closed peer connection for: ${peerId}`);
    });
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.participants.clear();
    this.iceCandidatesQueues.clear();

    // 4. Unsubscribe and remove Supabase channel
    if (this.channel) {
      this.channel.unsubscribe();
      supabase.removeChannel(this.channel);
      this.channel = null;
      console.log('[WALKIE-TALKIE] Unsubscribed from channel');
    }

    this.callbacks.onRemoteStreamsChanged(new Map());
    this.callbacks.onParticipantsChanged([]);
  }

  /**
   * Activates local microphone and broadcasts speaking-started event
   */
  public startSpeaking() {
    if (this.isForceMuted) {
      console.warn('[WALKIE-TALKIE] Cannot speak: You are muted by an admin.');
      return;
    }

    if (this.isRoomLocked && this.currentUserRole === 'member') {
      console.warn('[WALKIE-TALKIE] Cannot speak: Room is locked by an admin.');
      return;
    }

    if (this.isSpeaking) return;

    console.log('[WALKIE-TALKIE] Start speaking...');
    this.isSpeaking = true;

    // Enable local microphone tracks
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
        console.log(`[WALKIE-TALKIE] Local audio track unmuted: ${track.id}`);
      });
    }

    // Broadcast immediate speaking state
    this.channel?.send({
      type: 'broadcast',
      event: 'speaking',
      payload: { userId: this.currentUserId, isSpeaking: true },
    });

    this.callbacks.onSpeakingStateChanged(this.currentUserId, true);
    this.triggerParticipantsUpdate();
  }

  /**
   * Deactivates local microphone and broadcasts speaking-stopped event
   */
  public stopSpeaking() {
    if (!this.isSpeaking) return;

    console.log('[WALKIE-TALKIE] Stop speaking...');
    this.isSpeaking = false;

    // Disable local microphone tracks
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        console.log(`[WALKIE-TALKIE] Local audio track muted: ${track.id}`);
      });
    }

    // Broadcast immediate speaking state
    this.channel?.send({
      type: 'broadcast',
      event: 'speaking',
      payload: { userId: this.currentUserId, isSpeaking: false },
    });

    this.callbacks.onSpeakingStateChanged(this.currentUserId, false);
    this.triggerParticipantsUpdate();
  }

  /**
   * Action performed by an admin: mutes a user, kicks a user, or locks the room
   */
  public sendAdminAction(type: 'mute' | 'kick' | 'lock_room' | 'unlock_room', targetUserId?: string) {
    if (this.currentUserRole === 'member') {
      console.warn('[WALKIE-TALKIE] Non-admin cannot perform admin actions.');
      return;
    }

    console.log(`[WALKIE-TALKIE] Sending admin action [${type}] targetUserId=[${targetUserId}]`);

    this.channel?.send({
      type: 'broadcast',
      event: 'action',
      payload: {
        type,
        targetUserId,
        senderId: this.currentUserId,
      },
    });

    // If we locked or unlocked, update local room state too
    if (type === 'lock_room') {
      this.isRoomLocked = true;
      this.callbacks.onRoomLockChanged(true);
    } else if (type === 'unlock_room') {
      this.isRoomLocked = false;
      this.callbacks.onRoomLockChanged(false);
    }
  }

  /**
   * Handles Presence sync updates
   */
  private handlePresenceSync() {
    if (!this.channel) return;

    const presenceState = this.channel.presenceState();
    console.log('[WALKIE-TALKIE] Presence state synced:', presenceState);

    const activeIds = new Set<string>();
    const updatedParticipants = new Map<string, WalkieTalkieParticipant>();

    Object.entries(presenceState).forEach(([key, presences]) => {
      const pres = presences[0] as any;
      if (pres) {
        activeIds.add(pres.userId);
        
        // Retain existing connectionState and real-time speaking/mute states if already present
        const existing = this.participants.get(pres.userId);
        const isSpeaking = existing ? existing.isSpeaking : (pres.isSpeaking || false);

        updatedParticipants.set(pres.userId, {
          userId: pres.userId,
          username: pres.username,
          avatarSeed: pres.avatarSeed || pres.username,
          role: pres.role || 'member',
          isSpeaking: isSpeaking,
          isMuted: pres.isMuted || false,
          isMutedLocal: pres.isMutedLocal || false,
          joinedAt: pres.joinedAt,
          connectionState: existing?.connectionState || 'new',
        });
      }
    });

    // 1. Identify participants who have LEFT and clean up their WebRTC connection
    this.participants.forEach((p, userId) => {
      if (!activeIds.has(userId)) {
        console.log(`[WALKIE-TALKIE] Participant left presence room: ${userId}. Cleaning up peer connection.`);
        this.closePeerConnection(userId);
      }
    });

    // Update internal participants map
    this.participants = updatedParticipants;

    // 2. Identify new participants and initiate WebRTC connections based on lexicographical order rule
    this.participants.forEach((p, userId) => {
      if (userId === this.currentUserId) return; // Skip self

      if (!this.peerConnections.has(userId)) {
        console.log(`[WALKIE-TALKIE] New peer discovered: ${p.username} (userId=${userId})`);
        
        // Glare resolution rule: smaller lexicographical ID initiates offer, larger ID waits
        if (this.currentUserId < userId) {
          console.log(`[WALKIE-TALKIE] Lexicographical rule: ${this.currentUserId} < ${userId}. Initiating WebRTC offer.`);
          this.initiatePeerConnection(userId, true);
        } else {
          console.log(`[WALKIE-TALKIE] Lexicographical rule: ${this.currentUserId} > ${userId}. Waiting for peer's WebRTC offer.`);
          this.initiatePeerConnection(userId, false);
        }
      }
    });

    this.triggerParticipantsUpdate();
  }

  /**
   * Sets up RTCPeerConnection for a peer
   */
  private async initiatePeerConnection(peerId: string, isOfferCreator: boolean) {
    if (this.peerConnections.has(peerId)) return;

    console.log(`[WALKIE-TALKIE] Connecting to peer ${peerId} (isOfferCreator: ${isOfferCreator})`);

    const pcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    };

    const pc = new RTCPeerConnection(pcConfig);
    this.peerConnections.set(peerId, pc);
    this.iceCandidatesQueues.set(peerId, []);

    // Track connection state in participant list
    pc.onconnectionstatechange = () => {
      console.log(`[WALKIE-TALKIE] Connection state for peer ${peerId} changed to: ${pc.connectionState}`);
      const p = this.participants.get(peerId);
      if (p) {
        p.connectionState = pc.connectionState;
        this.triggerParticipantsUpdate();
      }

      // Compute overall connection quality
      this.evaluateConnectionQuality();
    };

    // Add local mic stream tracks to this peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
        console.log(`[WALKIE-TALKIE] Added local track [${track.kind}] to peer connection: ${peerId}`);
      });
    }

    // Handle remote audio tracks
    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      console.log(`[WALKIE-TALKIE] Received remote track from peer=${peerId}, kind=${event.track.kind}`);
      event.track.enabled = true;
      remoteStream.addTrack(event.track);

      this.remoteStreams.set(peerId, remoteStream);
      this.callbacks.onRemoteStreamsChanged(new Map(this.remoteStreams));
    };

    // Handle ICE Candidates and send via broadcast
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.channel?.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            senderId: this.currentUserId,
            receiverId: peerId,
            signalData: {
              type: 'candidate',
              candidate: event.candidate,
            },
          },
        });
      }
    };

    // If this peer is responsible for initiating the offer
    if (isOfferCreator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`[WALKIE-TALKIE] Created and set local SDP offer for peer: ${peerId}`);

        this.channel?.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            senderId: this.currentUserId,
            receiverId: peerId,
            signalData: {
              type: 'offer',
              sdp: offer,
            },
          },
        });
      } catch (err) {
        console.error(`[WALKIE-TALKIE] Error creating offer for peer ${peerId}:`, err);
      }
    }
  }

  /**
   * Processes incoming WebRTC signaling messages
   */
  private async handleSignalingEvent(event: any) {
    const { payload } = event;
    const { senderId, receiverId, signalData } = payload;

    // Filter signals targetting the current user
    if (receiverId !== this.currentUserId) return;

    let pc = this.peerConnections.get(senderId);

    // Lazily create peer connection if it doesn't exist and we receive an offer
    if (!pc) {
      if (signalData.type === 'offer') {
        console.log(`[WALKIE-TALKIE] Received unsolicited offer from peer ${senderId}. Creating peer connection.`);
        await this.initiatePeerConnection(senderId, false);
        pc = this.peerConnections.get(senderId);
      } else {
        console.warn(`[WALKIE-TALKIE] Received signaling event [${signalData.type}] from peer ${senderId} without active connection. Ignoring.`);
        return;
      }
    }

    if (!pc) return;

    try {
      if (signalData.type === 'offer') {
        console.log(`[WALKIE-TALKIE] Setting remote description offer from peer: ${senderId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        await this.flushIceCandidatesQueue(senderId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[WALKIE-TALKIE] Created and set local SDP answer for peer: ${senderId}`);

        this.channel?.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            senderId: this.currentUserId,
            receiverId: senderId,
            signalData: {
              type: 'answer',
              sdp: answer,
            },
          },
        });
      } else if (signalData.type === 'answer') {
        console.log(`[WALKIE-TALKIE] Setting remote description answer from peer: ${senderId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        await this.flushIceCandidatesQueue(senderId, pc);
      } else if (signalData.type === 'candidate') {
        const queue = this.iceCandidatesQueues.get(senderId) || [];
        if (pc.remoteDescription) {
          console.log(`[WALKIE-TALKIE] Adding ICE candidate immediately from peer: ${senderId}`);
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate)).catch((err) => {
            console.warn(`[WALKIE-TALKIE] Error applying direct ICE candidate for peer ${senderId}:`, err);
          });
        } else {
          console.log(`[WALKIE-TALKIE] Queueing ICE candidate for peer: ${senderId}`);
          queue.push(signalData.candidate);
          this.iceCandidatesQueues.set(senderId, queue);
        }
      }
    } catch (err) {
      console.error(`[WALKIE-TALKIE] Error handling signaling message from peer ${senderId}:`, err);
    }
  }

  /**
   * Handles incoming admin actions (mute, kick, lock)
   */
  private handleAdminActionEvent(event: any) {
    const { payload } = event;
    const { type, targetUserId, senderId } = payload;
    console.log(`[WALKIE-TALKIE] Received admin action: ${type}, targetUserId=${targetUserId}, senderId=${senderId}`);

    // If targetted at us
    if (targetUserId === this.currentUserId) {
      if (type === 'mute') {
        console.log('[WALKIE-TALKIE] You have been muted by an admin.');
        this.isForceMuted = true;
        this.stopSpeaking();
        this.callbacks.onForceMuted();

        // Sync presence state
        this.channel?.track({
          userId: this.currentUserId,
          username: this.currentUsername,
          avatarSeed: this.currentUsername,
          role: this.currentUserRole,
          isSpeaking: false,
          isMuted: true,
          isMutedLocal: false,
          joinedAt: new Date().toISOString(),
        });
      } else if (type === 'kick') {
        console.log('[WALKIE-TALKIE] You have been kicked from the Walkie-Talkie room by an admin.');
        this.callbacks.onKicked();
        this.leave();
      }
    }

    // Sync room lock states globally
    if (type === 'lock_room') {
      this.isRoomLocked = true;
      this.callbacks.onRoomLockChanged(true);
      if (this.currentUserRole === 'member') {
        this.stopSpeaking(); // Force stop speaking for normal members
      }
    } else if (type === 'unlock_room') {
      this.isRoomLocked = false;
      this.callbacks.onRoomLockChanged(false);
    }
  }

  /**
   * Fast speaking state updates to bypass Presence latency
   */
  private handleSpeakingBroadcastEvent(event: any) {
    const { payload } = event;
    const { userId, isSpeaking } = payload;
    if (userId === this.currentUserId) return;

    console.log(`[WALKIE-TALKIE] Instant speaking state update for peer ${userId}: isSpeaking=${isSpeaking}`);
    const p = this.participants.get(userId);
    if (p) {
      p.isSpeaking = isSpeaking;
      this.triggerParticipantsUpdate();
    }
    this.callbacks.onSpeakingStateChanged(userId, isSpeaking);
  }

  /**
   * Active admin syncs room status when a new user requests state
   */
  private handleRequestStateEvent(event: any) {
    const { payload } = event;
    const { senderId } = payload;
    if (senderId === this.currentUserId) return;

    // Only owners or admins respond, or the lexicographically smallest user as a fallback
    if (this.currentUserRole !== 'member') {
      console.log(`[WALKIE-TALKIE] Syncing room state to new user ${senderId}. RoomLocked=${this.isRoomLocked}`);
      this.channel?.send({
        type: 'broadcast',
        event: 'sync_state',
        payload: {
          locked: this.isRoomLocked,
          targetUserId: senderId,
        },
      });
    }
  }

  /**
   * Receive room status sync from an existing active admin
   */
  private handleSyncStateEvent(event: any) {
    const { payload } = event;
    const { locked, targetUserId } = payload;
    if (targetUserId !== this.currentUserId) return;

    console.log(`[WALKIE-TALKIE] Received synchronized room lock state: ${locked}`);
    this.isRoomLocked = locked;
    this.callbacks.onRoomLockChanged(locked);
  }

  /**
   * Closes a single peer connection
   */
  private closePeerConnection(peerId: string) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
    this.participants.delete(peerId);
    this.iceCandidatesQueues.delete(peerId);

    this.callbacks.onRemoteStreamsChanged(new Map(this.remoteStreams));
    this.triggerParticipantsUpdate();
    this.evaluateConnectionQuality();
  }

  /**
   * Flush queued ICE candidates after the remote description is applied
   */
  private async flushIceCandidatesQueue(peerId: string, pc: RTCPeerConnection) {
    const queue = this.iceCandidatesQueues.get(peerId) || [];
    if (queue.length > 0) {
      console.log(`[WALKIE-TALKIE] Flushing ${queue.length} queued ICE candidates for peer: ${peerId}`);
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
            console.warn(`[WALKIE-TALKIE] Error applying queued ICE candidate for peer ${peerId}:`, err);
          });
        }
      }
    }
  }

  /**
   * Re-evaluates connection quality across all peers
   */
  private evaluateConnectionQuality() {
    if (this.isConnecting) {
      this.callbacks.onConnectionQualityChanged('connecting');
      return;
    }

    if (this.peerConnections.size === 0) {
      this.callbacks.onConnectionQualityChanged('excellent');
      return;
    }

    let connectedCount = 0;
    let connectingCount = 0;
    let failedCount = 0;

    this.peerConnections.forEach((pc) => {
      if (pc.connectionState === 'connected') connectedCount++;
      else if (pc.connectionState === 'connecting') connectingCount++;
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') failedCount++;
    });

    if (failedCount > 0) {
      this.callbacks.onConnectionQualityChanged('poor');
    } else if (connectingCount > 0) {
      this.callbacks.onConnectionQualityChanged('good');
    } else {
      this.callbacks.onConnectionQualityChanged('excellent');
    }
  }

  private triggerParticipantsUpdate() {
    this.callbacks.onParticipantsChanged(Array.from(this.participants.values()));
  }
}
