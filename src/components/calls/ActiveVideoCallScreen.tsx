import React, { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Video, VideoOff, SwitchCamera, PhoneOff, Lock } from 'lucide-react';
import { Call, Profile } from '../../types/calls';

interface ActiveVideoCallScreenProps {
  call: Call;
  recipient: Profile | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraEnabled: boolean;
  callDuration: number;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onEndCall: () => void;
}

export const ActiveVideoCallScreen: React.FC<ActiveVideoCallScreenProps> = ({
  call,
  recipient,
  localStream,
  remoteStream,
  isMuted,
  isCameraEnabled,
  callDuration,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onEndCall
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  
  const username = recipient?.username || 'Unknown Contact';

  // Format seconds to mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Bind local video stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log('[CALLS] Binding local video stream');
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch((err) => {
        console.warn('[CALLS] Local video autoplay failed or was blocked:', err);
      });
    }
  }, [localStream, isCameraEnabled]);

  // Bind remote video stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log('[CALLS] Binding remote video stream');
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch((err) => {
        console.warn('[CALLS] Remote video autoplay failed or was blocked:', err);
      });
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col justify-between overflow-hidden">
      
      {/* 1. Fullscreen Remote Video */}
      <div className="absolute inset-0 bg-zinc-950 flex items-center justify-center">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center text-center gap-4">
            <span className="w-20 h-20 rounded-full bg-[#1f2c34] animate-pulse flex items-center justify-center border border-emerald-500/20">
              <VideoOff className="w-8 h-8 text-gray-400" />
            </span>
            <div>
              <p className="text-sm font-semibold">{username}</p>
              <p className="text-xs text-gray-400">Waiting for remote video stream...</p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Top Bar Overlay */}
      <div className="relative z-10 w-full px-6 py-4 bg-gradient-to-b from-black/60 to-transparent flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 font-semibold flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp SECURE VIDEO
          </span>
          <h3 className="text-lg font-semibold text-white drop-shadow-md">{username}</h3>
        </div>
        <div className="bg-[#111b21]/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-gray-800 text-sm font-mono text-emerald-400 shadow-md">
          {formatDuration(callDuration)}
        </div>
      </div>

      {/* 3. Local Picture-in-Picture Preview Overlay */}
      {isCameraEnabled && localStream ? (
        <motion.div
          drag
          dragConstraints={{ left: 10, right: window.innerWidth - 130, top: 10, bottom: window.innerHeight - 170 }}
          className="absolute right-4 top-20 z-20 w-28 h-40 md:w-36 md:h-48 bg-[#111b21] rounded-xl border border-emerald-500/30 overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing"
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]" // mirror local preview
          />
        </motion.div>
      ) : null}

      {/* 4. Controls Overlay at the bottom */}
      <div className="relative z-10 w-full px-6 py-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex justify-center">
        <div className="bg-[#111b21]/90 backdrop-blur-md border border-gray-800 rounded-3xl px-8 py-4 flex items-center gap-6 md:gap-8 shadow-2xl">
          
          {/* Mute Mic */}
          <button
            id="toggle-video-mute-btn"
            onClick={onToggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isMuted
                ? 'bg-red-600/30 text-red-500 border border-red-500/30 hover:bg-red-600/40'
                : 'bg-[#202c33]/80 text-gray-300 hover:bg-gray-700/80 hover:text-white'
            }`}
            title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isMuted ? <MicOff className="w-5.5 h-5.5" /> : <Mic className="w-5.5 h-5.5" />}
          </button>

          {/* Toggle Camera */}
          <button
            id="toggle-video-camera-btn"
            onClick={onToggleCamera}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              !isCameraEnabled
                ? 'bg-red-600/30 text-red-500 border border-red-500/30 hover:bg-red-600/40'
                : 'bg-[#202c33]/80 text-gray-300 hover:bg-gray-700/80 hover:text-white'
            }`}
            title={isCameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            {isCameraEnabled ? <Video className="w-5.5 h-5.5" /> : <VideoOff className="w-5.5 h-5.5" />}
          </button>

          {/* Switch Facing Camera (Front/Back) */}
          <button
            id="switch-video-camera-btn"
            onClick={onSwitchCamera}
            disabled={!isCameraEnabled}
            className="w-12 h-12 rounded-full bg-[#202c33]/80 text-gray-300 hover:bg-gray-700/80 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all cursor-pointer"
            title="Switch front/back camera"
          >
            <SwitchCamera className="w-5.5 h-5.5" />
          </button>

          {/* End Call (Red Button) */}
          <motion.button
            id="end-video-call-btn"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onEndCall}
            className="w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-red-600/30 transition-all cursor-pointer"
            title="Hang Up"
          >
            <PhoneOff className="w-6.5 h-6.5 rotate-135" />
          </motion.button>

        </div>
      </div>
    </div>
  );
};

export default ActiveVideoCallScreen;
