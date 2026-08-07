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
      const nativeStream = streams[0];
      const nativeStreamId = nativeStream?.id || 'N/A';
      console.log(`[1TO1-WEBRTC] [ontrack] Ontrack event fired! Received remote track: id=${event.track.id}, kind=${event.track.kind}, enabled=${event.track.enabled}, readyState=${event.track.readyState}. Native remote stream ID: ${nativeStreamId}`);
      
      event.track.enabled = true;
      
      let streamToPropagate: MediaStream;
      if (nativeStream) {
        nativeStream.getTracks().forEach((track) => {
          track.enabled = true;
        });
        streamToPropagate = nativeStream;
      } else {
        const exists = this.remoteStream.getTracks().some(t => t.id === event.track.id);
        if (!exists) {
          this.remoteStream.addTrack(event.track);
          console.log(`[1TO1-WEBRTC] [ontrack] Consolidated remote track [id=${event.track.id}, kind=${event.track.kind}] into persistent remoteStream`);
        }
        streamToPropagate = this.remoteStream;
      }

      const consolidatedTracks = streamToPropagate.getTracks();
      const audioTracks = streamToPropagate.getAudioTracks();
      const videoTracks = streamToPropagate.getVideoTracks();
      
      console.log(`[1TO1-WEBRTC] [ontrack] Propagating remoteStream detail: id=${streamToPropagate.id}, totalTracks=${consolidatedTracks.length}, audioTracksCount=${audioTracks.length}, videoTracksCount=${videoTracks.length}`);
      consolidatedTracks.forEach((t, i) => {
        console.log(`  -> Track ${i}: id=${t.id}, kind=${t.kind}, enabled=${t.enabled}, readyState=${t.readyState}`);
      });

      this.onRemoteStream(streamToPropagate);
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
