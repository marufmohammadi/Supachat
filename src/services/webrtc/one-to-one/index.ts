import { CallSignal } from '../../../types/calls';

export class OneToOneWebRTCManager {
  public pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream;
  private callId: string;
  private currentUserId: string;
  private onRemoteStream: (stream: MediaStream) => void;
  private onIceCandidate: (candidate: any) => void;
  private handleIceConnectionFailure: () => void;

  constructor(
    callId: string,
    currentUserId: string,
    onRemoteStream: (stream: MediaStream) => void,
    onIceCandidate: (candidate: any) => void,
    handleIceConnectionFailure: () => void
  ) {
    this.callId = callId;
    this.currentUserId = currentUserId;
    this.onRemoteStream = onRemoteStream;
    this.onIceCandidate = onIceCandidate;
    this.handleIceConnectionFailure = handleIceConnectionFailure;
    this.remoteStream = new MediaStream();
    console.log('[1TO1-WEBRTC] Created OneToOneWebRTCManager instance for call:', callId);
  }

  public initialize(stream: MediaStream): RTCPeerConnection {
    console.log('[1TO1-WEBRTC] Setting up RTCPeerConnection. Local stream ID:', stream.id);
    this.localStream = stream;

    // Enhanced STUN configuration for improved ICE candidate gathering across NATs/firewalls
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
    this.pc = pc;

    // Log local tracks count and details as requested
    const localTracks = stream.getTracks();
    console.log(`[1TO1-WEBRTC] Local stream detail: id=${stream.id}, audioTrackCount=${stream.getAudioTracks().length}, videoTrackCount=${stream.getVideoTracks().length}`);
    
    // Add local tracks to peer connection and ensure they are active/enabled
    localTracks.forEach((track) => {
      track.enabled = true;
      pc.addTrack(track, stream);
      console.log(`[1TO1-WEBRTC] [addTrack] Added local track to peer connection: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
    });

    // Handle incoming remote media tracks (consolidating into persistent stream reference)
    pc.ontrack = (event) => {
      const streams = event.streams || [];
      const nativeStreamId = streams[0]?.id || 'N/A';
      console.log(`[1TO1-WEBRTC] [ontrack] Ontrack event fired! Received remote track: id=${event.track.id}, kind=${event.track.kind}, enabled=${event.track.enabled}, readyState=${event.track.readyState}. Native remote stream ID: ${nativeStreamId}`);
      
      event.track.enabled = true;
      
      // Robust consolidation: accumulate all remote tracks into this.remoteStream
      const exists = this.remoteStream.getTracks().some(t => t.id === event.track.id);
      if (!exists) {
        this.remoteStream.addTrack(event.track);
        console.log(`[1TO1-WEBRTC] [ontrack] Consolidated remote track [id=${event.track.id}, kind=${event.track.kind}] into persistent remoteStream`);
      } else {
        console.log(`[1TO1-WEBRTC] [ontrack] Track [id=${event.track.id}] already present in persistent remoteStream`);
      }

      // Also ensure any additional tracks present in the native event streams are accumulated
      if (streams[0]) {
        streams[0].getTracks().forEach((track) => {
          track.enabled = true;
          const hasTrack = this.remoteStream.getTracks().some(t => t.id === track.id);
          if (!hasTrack) {
            this.remoteStream.addTrack(track);
            console.log(`[1TO1-WEBRTC] [ontrack] Consolidated additional track [id=${track.id}, kind=${track.kind}] from native stream into persistent remoteStream`);
          }
        });
      }

      // Output remote stream details as requested
      const consolidatedTracks = this.remoteStream.getTracks();
      const audioTracks = this.remoteStream.getAudioTracks();
      const videoTracks = this.remoteStream.getVideoTracks();
      
      console.log(`[1TO1-WEBRTC] [ontrack] Current persistent remoteStream detail: id=${this.remoteStream.id}, totalTracks=${consolidatedTracks.length}, audioTracksCount=${audioTracks.length}, videoTracksCount=${videoTracks.length}`);
      consolidatedTracks.forEach((t, i) => {
        console.log(`  -> Track ${i}: id=${t.id}, kind=${t.kind}, enabled=${t.enabled}, readyState=${t.readyState}`);
      });

      // Construct and return a fresh MediaStream containing all accumulated tracks to safely trigger React state re-render
      const freshStream = new MediaStream(this.remoteStream.getTracks());
      console.log(`[1TO1-WEBRTC] [ontrack] Propagating fresh remote MediaStream reference to handler: id=${freshStream.id}, trackCount=${freshStream.getTracks().length}`);
      this.onRemoteStream(freshStream);
    };

    // Handle ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[1TO1-WEBRTC] [onicecandidate] Generated ICE Candidate. Candidate: ${event.candidate.candidate}, sdpMid: ${event.candidate.sdpMid}, sdpMLineIndex: ${event.candidate.sdpMLineIndex}`);
        this.onIceCandidate(event.candidate.toJSON());
      } else {
        console.log('[1TO1-WEBRTC] [onicecandidate] ICE candidate gathering finished (null candidate)');
      }
    };

    // Connection state debugging logs as requested
    pc.onconnectionstatechange = () => {
      console.log(`[1TO1-WEBRTC] [onconnectionstatechange] connectionState changed to: ${pc.connectionState}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[1TO1-WEBRTC] [onsignalingstatechange] signalingState changed to: ${pc.signalingState}`);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[1TO1-WEBRTC] [oniceconnectionstatechange] iceConnectionState changed to: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('[1TO1-WEBRTC] Peer connection lost/failed. Triggering reconnection check...');
        this.handleIceConnectionFailure();
      }
    };

    return pc;
  }

  public destroy() {
    console.log('[1TO1-WEBRTC] Destroying WebRTC resources');
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream.getTracks().forEach((track) => {
      track.stop();
      console.log(`[1TO1-WEBRTC] Stopped remote track: kind=${track.kind}, id=${track.id}`);
    });
  }
}
