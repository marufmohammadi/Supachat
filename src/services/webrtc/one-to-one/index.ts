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
    console.log('[1TO1-WEBRTC] Setting up RTCPeerConnection');
    this.localStream = stream;

    const pcConfig: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(pcConfig);
    this.pc = pc;

    // Log local tracks count as requested
    const localTracks = stream.getTracks();
    console.log(`[1TO1-WEBRTC] Local tracks count: ${localTracks.length}`);

    // Add local tracks to peer connection and ensure they are active/enabled
    localTracks.forEach((track) => {
      track.enabled = true;
      pc.addTrack(track, stream);
      console.log(`[1TO1-WEBRTC] Added local track to peer connection [kind=${track.kind}, enabled=${track.enabled}]`);
    });

    // Handle incoming remote media tracks (accumulating into a single stream cleanly)
    pc.ontrack = (event) => {
      const receivedTracksCount = event.streams[0]?.getTracks().length || 0;
      console.log(`[1TO1-WEBRTC] ontrack event fired. Received remote track [kind=${event.track.kind}, enabled=${event.track.enabled}]. Streams tracks count: ${receivedTracksCount}`);
      
      event.track.enabled = true;
      
      if (event.streams && event.streams[0]) {
        console.log('[1TO1-WEBRTC] Using native remote stream from ontrack event');
        // Ensure all tracks in the stream are enabled
        event.streams[0].getTracks().forEach((track) => {
          track.enabled = true;
        });
        this.onRemoteStream(event.streams[0]);
      } else {
        console.log('[1TO1-WEBRTC] No stream found in ontrack event. Constructing manually.');
        // Avoid duplicate tracks
        const exists = this.remoteStream.getTracks().some(t => t.id === event.track.id);
        if (!exists) {
          this.remoteStream.addTrack(event.track);
        }
        this.onRemoteStream(new MediaStream(this.remoteStream.getTracks()));
      }
    };

    // Handle ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[1TO1-WEBRTC] Generated ICE Candidate, sending to peer');
        this.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Connection state debugging logs as requested
    pc.onconnectionstatechange = () => {
      console.log('[1TO1-WEBRTC] connectionState changed:', pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[1TO1-WEBRTC] signalingState changed:', pc.signalingState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[1TO1-WEBRTC] iceConnectionState changed:', pc.iceConnectionState);
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
    this.remoteStream.getTracks().forEach((track) => track.stop());
  }
}
