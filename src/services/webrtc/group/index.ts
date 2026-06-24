import { groupSignalingService } from '../../group-signaling';

export interface PeerConnectionInfo {
  peerId: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  iceCandidatesQueue: RTCIceCandidateInit[];
}

export class GroupWebRTCManager {
  private roomId: string;
  private currentUserId: string;
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, PeerConnectionInfo> = new Map();
  private onRemoteStreamsChanged: (streams: Map<string, MediaStream>) => void;
  private onParticipantStateChange: (peerId: string, isMuted: boolean, cameraEnabled: boolean) => void;

  constructor(
    roomId: string,
    currentUserId: string,
    onRemoteStreamsChanged: (streams: Map<string, MediaStream>) => void,
    onParticipantStateChange: (peerId: string, isMuted: boolean, cameraEnabled: boolean) => void
  ) {
    this.roomId = roomId;
    this.currentUserId = currentUserId;
    this.onRemoteStreamsChanged = onRemoteStreamsChanged;
    this.onParticipantStateChange = onParticipantStateChange;
    console.log(`[GROUP-WEBRTC] Initialized WebRTC Mesh Manager for room ${roomId}, user ${currentUserId}`);
  }

  /**
   * Updates the local media stream and syncs tracks to all active peer connections
   */
  public setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    
    // For all existing peer connections, update their local tracks if they don't have them
    this.peerConnections.forEach((info) => {
      const localTracks = stream.getTracks();
      console.log(`[GROUP-WEBRTC] Syncing local tracks. Total count: ${localTracks.length} for peer ${info.peerId}`);
      
      localTracks.forEach((track) => {
        const senders = info.pc.getSenders();
        const hasTrack = senders.some((s) => s.track?.id === track.id || s.track?.kind === track.kind);
        if (!hasTrack) {
          track.enabled = true;
          info.pc.addTrack(track, stream);
          console.log(`[GROUP-WEBRTC] Added track [kind=${track.kind}] to peer connection for ${info.peerId}`);
        }
      });
    });
  }

  /**
   * Initializes a peer connection for a participant and handles negotiations
   */
  public async connectToPeer(peerId: string, shouldCreateOffer: boolean) {
    if (this.peerConnections.has(peerId)) {
      console.log(`[GROUP-WEBRTC] Connection already exists for peer ${peerId}`);
      return;
    }

    console.log(`[GROUP-WEBRTC] Creating new peer connection for peer ${peerId} (offer: ${shouldCreateOffer})`);

    const pcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(pcConfig);
    const remoteStream = new MediaStream();

    const info: PeerConnectionInfo = {
      peerId,
      pc,
      remoteStream,
      iceCandidatesQueue: []
    };

    this.peerConnections.set(peerId, info);

    // 1. Add local tracks
    if (this.localStream) {
      const localTracks = this.localStream.getTracks();
      console.log(`[GROUP-WEBRTC] Adding local tracks. Total count: ${localTracks.length} for peer ${peerId}`);
      localTracks.forEach((track) => {
        track.enabled = true;
        pc.addTrack(track, this.localStream!);
        console.log(`[GROUP-WEBRTC] Local track [kind=${track.kind}] added to pc for ${peerId}`);
      });
    }

    // 2. Handle remote tracks
    pc.ontrack = (event) => {
      const receivedTracksCount = event.streams[0]?.getTracks().length || 0;
      console.log(`[GROUP-WEBRTC] Received remote track from peer ${peerId}: kind=${event.track.kind}, enabled=${event.track.enabled}. Current stream track count: ${receivedTracksCount}`);
      
      event.track.enabled = true;

      if (event.streams && event.streams[0]) {
        console.log(`[GROUP-WEBRTC] Using native remote stream from peer ${peerId}`);
        event.streams[0].getTracks().forEach((track) => {
          track.enabled = true;
        });
        info.remoteStream = new MediaStream(event.streams[0].getTracks());
      } else {
        console.log(`[GROUP-WEBRTC] No stream found in ontrack event for peer ${peerId}. Constructing manually.`);
        const exists = info.remoteStream.getTracks().some(t => t.id === event.track.id);
        if (!exists) {
          info.remoteStream.addTrack(event.track);
        }
        info.remoteStream = new MediaStream(info.remoteStream.getTracks());
      }

      // Trigger a state update by passing a fresh Map copy to the hook
      this.triggerRemoteStreamsUpdate();
    };

    // 3. Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[GROUP-WEBRTC] Generated ICE candidate for peer ${peerId}`);
        groupSignalingService.sendSignal(
          this.roomId,
          this.currentUserId,
          peerId,
          'candidate',
          event.candidate.toJSON()
        );
      }
    };

    // 4. Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[GROUP-WEBRTC] Connection state for ${peerId} changed to:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[GROUP-WEBRTC] Connection failed with ${peerId}. Restarting ICE...`);
        this.restartIceForPeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[GROUP-WEBRTC] ICE connection state for ${peerId}:`, pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[GROUP-WEBRTC] Signaling state for ${peerId}:`, pc.signalingState);
    };

    // 5. Create Offer if initiating
    if (shouldCreateOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`[GROUP-WEBRTC] Sent SDP offer to peer ${peerId}`);
        await groupSignalingService.sendSignal(
          this.roomId,
          this.currentUserId,
          peerId,
          'offer',
          offer
        );
      } catch (err) {
        console.error(`[GROUP-WEBRTC] Error creating offer for peer ${peerId}:`, err);
      }
    }
  }

  /**
   * Restarts ICE negotiation for a specific peer when connection drops
   */
  private async restartIceForPeer(peerId: string) {
    const info = this.peerConnections.get(peerId);
    if (!info) return;

    try {
      console.log(`[GROUP-WEBRTC] Initiating ICE restart for peer ${peerId}`);
      const offer = await info.pc.createOffer({ iceRestart: true });
      await info.pc.setLocalDescription(offer);
      await groupSignalingService.sendSignal(
        this.roomId,
        this.currentUserId,
        peerId,
        'offer',
        offer
      );
    } catch (err) {
      console.error(`[GROUP-WEBRTC] Failed ICE restart for peer ${peerId}:`, err);
    }
  }

  /**
   * Handles incoming signaling messages (offers, answers, ICE candidates)
   */
  public async handleIncomingSignal(peerId: string, type: 'offer' | 'answer' | 'candidate', data: any) {
    // If the connection doesn't exist, create it (newcomers might send candidates or offers)
    if (!this.peerConnections.has(peerId)) {
      await this.connectToPeer(peerId, false);
    }

    const info = this.peerConnections.get(peerId);
    if (!info) return;

    const pc = info.pc;

    try {
      if (type === 'offer') {
        console.log(`[GROUP-WEBRTC] Applying remote offer from peer ${peerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(data));

        // Flush any queued ICE candidates
        if (info.iceCandidatesQueue.length > 0) {
          console.log(`[GROUP-WEBRTC] Applying ${info.iceCandidatesQueue.length} queued ICE candidates for ${peerId}`);
          while (info.iceCandidatesQueue.length > 0) {
            const candidate = info.iceCandidatesQueue.shift();
            if (candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
                console.warn('[GROUP-WEBRTC] Queued ICE candidate error:', err);
              });
            }
          }
        }

        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[GROUP-WEBRTC] Created and sent SDP answer to peer ${peerId}`);
        await groupSignalingService.sendSignal(
          this.roomId,
          this.currentUserId,
          peerId,
          'answer',
          answer
        );

      } else if (type === 'answer') {
        console.log(`[GROUP-WEBRTC] Applying remote answer from peer ${peerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(data));

        // Flush any queued ICE candidates
        if (info.iceCandidatesQueue.length > 0) {
          console.log(`[GROUP-WEBRTC] Applying ${info.iceCandidatesQueue.length} queued ICE candidates for ${peerId}`);
          while (info.iceCandidatesQueue.length > 0) {
            const candidate = info.iceCandidatesQueue.shift();
            if (candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
                console.warn('[GROUP-WEBRTC] Queued ICE candidate error:', err);
              });
            }
          }
        }

      } else if (type === 'candidate') {
        if (pc.remoteDescription) {
          console.log(`[GROUP-WEBRTC] Applying immediate ICE candidate from peer ${peerId}`);
          await pc.addIceCandidate(new RTCIceCandidate(data)).catch((err) => {
            console.warn('[GROUP-WEBRTC] Error applying direct ICE candidate:', err);
          });
        } else {
          console.log(`[GROUP-WEBRTC] Queueing ICE candidate for peer ${peerId}`);
          info.iceCandidatesQueue.push(data);
        }
      }
    } catch (err) {
      console.error(`[GROUP-WEBRTC] Error processing incoming signal [${type}] from peer ${peerId}:`, err);
    }
  }

  /**
   * Disconnects and cleans up peer connection for a participant who left
   */
  public disconnectPeer(peerId: string) {
    const info = this.peerConnections.get(peerId);
    if (info) {
      console.log(`[GROUP-WEBRTC] Disconnecting peer ${peerId}`);
      info.pc.close();
      info.remoteStream.getTracks().forEach((track) => track.stop());
      this.peerConnections.delete(peerId);
      this.triggerRemoteStreamsUpdate();
    }
  }

  /**
   * Closes all peer connections and stops media tracks
   */
  public destroy() {
    console.log('[GROUP-WEBRTC] Destroying Mesh manager and clearing all connections');
    this.peerConnections.forEach((info) => {
      info.pc.close();
      info.remoteStream.getTracks().forEach((track) => track.stop());
    });
    this.peerConnections.clear();
    this.triggerRemoteStreamsUpdate();
  }

  /**
   * Notifies the callback about the updated remote streams map
   */
  private triggerRemoteStreamsUpdate() {
    const streamsMap = new Map<string, MediaStream>();
    this.peerConnections.forEach((info, peerId) => {
      // Include streams that have any active tracks (audio or video)
      if (info.remoteStream.getTracks().length > 0) {
        streamsMap.set(peerId, info.remoteStream);
      }
    });
    this.onRemoteStreamsChanged(streamsMap);
  }
}
