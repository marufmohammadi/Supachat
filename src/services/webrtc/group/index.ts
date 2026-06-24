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
      console.log(`[GROUP-WEBRTC] Syncing local tracks. streamId=${stream.id}, tracksCount=${localTracks.length} for peer ${info.peerId}`);
      
      localTracks.forEach((track) => {
        const senders = info.pc.getSenders();
        const hasTrack = senders.some((s) => s.track?.id === track.id || s.track?.kind === track.kind);
        if (!hasTrack) {
          track.enabled = true;
          info.pc.addTrack(track, stream);
          console.log(`[GROUP-WEBRTC] [setLocalStream] Added local track to peer connection for ${info.peerId}: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}`);
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

    console.log(`[GROUP-WEBRTC] Creating new peer connection for peer ${peerId} (shouldCreateOffer: ${shouldCreateOffer})`);

    // Enhanced STUN configuration for robust NAT traversal across varied networks
    const pcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
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
      console.log(`[GROUP-WEBRTC] Adding local tracks. localStreamId=${this.localStream.id}, count=${localTracks.length} for peer ${peerId}`);
      localTracks.forEach((track) => {
        track.enabled = true;
        pc.addTrack(track, this.localStream!);
        console.log(`[GROUP-WEBRTC] Local track [id=${track.id}, kind=${track.kind}, enabled=${track.enabled}] added to pc for ${peerId}`);
      });
    } else {
      console.warn(`[GROUP-WEBRTC] No localStream available yet to add for peer ${peerId}`);
    }

    // 2. Handle remote tracks (consolidating into persistent peer remoteStream)
    pc.ontrack = (event) => {
      const streams = event.streams || [];
      const nativeStreamId = streams[0]?.id || 'N/A';
      console.log(`[GROUP-WEBRTC] [ontrack] Ontrack event fired for peer ${peerId}. Remote track: id=${event.track.id}, kind=${event.track.kind}, enabled=${event.track.enabled}, readyState=${event.track.readyState}. Native remote stream ID: ${nativeStreamId}`);
      
      event.track.enabled = true;

      // Consolidate track into info.remoteStream
      const exists = info.remoteStream.getTracks().some(t => t.id === event.track.id);
      if (!exists) {
        info.remoteStream.addTrack(event.track);
        console.log(`[GROUP-WEBRTC] [ontrack] Consolidated remote track [id=${event.track.id}, kind=${event.track.kind}] into persistent remoteStream for peer ${peerId}`);
      } else {
        console.log(`[GROUP-WEBRTC] [ontrack] Track [id=${event.track.id}] already present in persistent remoteStream for peer ${peerId}`);
      }

      // Consolidate additional tracks from the native event stream
      if (streams[0]) {
        streams[0].getTracks().forEach((track) => {
          track.enabled = true;
          const hasTrack = info.remoteStream.getTracks().some(t => t.id === track.id);
          if (!hasTrack) {
            info.remoteStream.addTrack(track);
            console.log(`[GROUP-WEBRTC] [ontrack] Consolidated additional track [id=${track.id}, kind=${track.kind}] from native stream for peer ${peerId}`);
          }
        });
      }

      // Log consolidated streams detail as requested
      const consolidatedTracks = info.remoteStream.getTracks();
      const audioTracks = info.remoteStream.getAudioTracks();
      const videoTracks = info.remoteStream.getVideoTracks();
      console.log(`[GROUP-WEBRTC] [ontrack] Consolidated remoteStream for peer ${peerId}: id=${info.remoteStream.id}, totalTracks=${consolidatedTracks.length}, audioTracksCount=${audioTracks.length}, videoTracksCount=${videoTracks.length}`);
      consolidatedTracks.forEach((t, i) => {
        console.log(`  -> Track ${i}: id=${t.id}, kind=${t.kind}, enabled=${t.enabled}, readyState=${t.readyState}`);
      });

      // Assign a fresh MediaStream reference with accumulated tracks to safely trigger React state re-render
      info.remoteStream = new MediaStream(info.remoteStream.getTracks());

      // Trigger a state update by passing a fresh Map copy to the hook
      this.triggerRemoteStreamsUpdate();
    };

    // 3. Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[GROUP-WEBRTC] [onicecandidate] Generated ICE candidate for peer ${peerId}. Candidate: ${event.candidate.candidate}, sdpMid: ${event.candidate.sdpMid}, sdpMLineIndex: ${event.candidate.sdpMLineIndex}`);
        groupSignalingService.sendSignal(
          this.roomId,
          this.currentUserId,
          peerId,
          'candidate',
          event.candidate.toJSON()
        );
      } else {
        console.log(`[GROUP-WEBRTC] [onicecandidate] ICE candidate gathering finished for peer ${peerId}`);
      }
    };

    // 4. Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[GROUP-WEBRTC] [onconnectionstatechange] Connection state for peer ${peerId} changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[GROUP-WEBRTC] [onconnectionstatechange] Connection failed with ${peerId}. Restarting ICE...`);
        this.restartIceForPeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[GROUP-WEBRTC] [oniceconnectionstatechange] ICE connection state for peer ${peerId}: ${pc.iceConnectionState}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[GROUP-WEBRTC] [onsignalingstatechange] Signaling state for peer ${peerId}: ${pc.signalingState}`);
    };

    // 5. Create Offer if initiating
    if (shouldCreateOffer) {
      try {
        console.log(`[GROUP-WEBRTC] Creating SDP Offer for peer ${peerId}...`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`[GROUP-WEBRTC] Local SDP Offer description set successfully. Sending to peer ${peerId}.`);
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
      console.log(`[GROUP-WEBRTC] ICE restart local offer set successfully. Sending to peer ${peerId}.`);
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
        console.log(`[GROUP-WEBRTC] Setting remote description for offer from peer ${peerId}...`);
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        console.log(`[GROUP-WEBRTC] Remote SDP Offer applied successfully for peer ${peerId}`);

        // Flush any queued ICE candidates
        if (info.iceCandidatesQueue.length > 0) {
          console.log(`[GROUP-WEBRTC] Applying ${info.iceCandidatesQueue.length} queued ICE candidates for peer ${peerId}`);
          while (info.iceCandidatesQueue.length > 0) {
            const candidate = info.iceCandidatesQueue.shift();
            if (candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
                console.warn(`[GROUP-WEBRTC] Error applying queued ICE candidate for peer ${peerId}:`, err);
              });
            }
          }
        }

        // Create answer
        console.log(`[GROUP-WEBRTC] Creating SDP Answer for peer ${peerId}...`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[GROUP-WEBRTC] Local SDP Answer set and sent to peer ${peerId}`);
        await groupSignalingService.sendSignal(
          this.roomId,
          this.currentUserId,
          peerId,
          'answer',
          answer
        );

      } else if (type === 'answer') {
        console.log(`[GROUP-WEBRTC] Setting remote description for answer from peer ${peerId}...`);
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        console.log(`[GROUP-WEBRTC] Remote SDP Answer applied successfully for peer ${peerId}`);

        // Flush any queued ICE candidates
        if (info.iceCandidatesQueue.length > 0) {
          console.log(`[GROUP-WEBRTC] Applying ${info.iceCandidatesQueue.length} queued ICE candidates for peer ${peerId}`);
          while (info.iceCandidatesQueue.length > 0) {
            const candidate = info.iceCandidatesQueue.shift();
            if (candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
                console.warn(`[GROUP-WEBRTC] Error applying queued ICE candidate for peer ${peerId}:`, err);
              });
            }
          }
        }

      } else if (type === 'candidate') {
        if (pc.remoteDescription) {
          console.log(`[GROUP-WEBRTC] Applying ICE candidate immediately from peer ${peerId}`);
          await pc.addIceCandidate(new RTCIceCandidate(data)).catch((err) => {
            console.warn(`[GROUP-WEBRTC] Error applying direct ICE candidate for peer ${peerId}:`, err);
          });
        } else {
          console.log(`[GROUP-WEBRTC] Queueing ICE candidate for peer ${peerId} (remote description not set yet)`);
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
      info.remoteStream.getTracks().forEach((track) => {
        track.stop();
        console.log(`[GROUP-WEBRTC] Stopped remote track: kind=${track.kind}, id=${track.id} for peer ${peerId}`);
      });
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
      info.remoteStream.getTracks().forEach((track) => {
        track.stop();
        console.log(`[GROUP-WEBRTC] Stopped remote track: kind=${track.kind}, id=${track.id} for peer ${info.peerId}`);
      });
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
