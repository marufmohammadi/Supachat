import React, { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Volume2, VolumeX, PhoneOff, Lock } from 'lucide-react';
import { Call, Profile } from '../../types/calls';

interface ActiveVoiceCallScreenProps {
  call: Call;
  recipient: Profile | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isSpeakerMode: boolean;
  callDuration: number;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
}

export const ActiveVoiceCallScreen: React.FC<ActiveVoiceCallScreenProps> = ({
  call,
  recipient,
  remoteStream,
  isMuted,
  isSpeakerMode,
  callDuration,
  onToggleMute,
  onToggleSpeaker,
  onEndCall
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const username = recipient?.username || 'Unknown Contact';
  const avatarUrl = recipient?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${call.receiver_id}`;

  // Format seconds to mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Bind the remote WebRTC audio stream to playing element
  useEffect(() => {
    if (audioRef.current && remoteStream) {
      console.log('[CALLS] Binding remote stream to audio element');
      audioRef.current.srcObject = remoteStream;
      
      // Attempt play (handling browser autoplay policies safely)
      audioRef.current.play().catch((err) => {
        console.warn('[CALLS] Autoplay audio permission delayed:', err);
      });
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#0b141a] text-white p-6 md:p-12">
      {/* Hidden play element for remote sound stream */}
      <audio ref={audioRef} autoPlay />

      {/* Header Info */}
      <div className="w-full flex justify-between items-center text-[#8696a0]">
        <span className="text-xs uppercase tracking-widest font-mono flex items-center gap-1">
          <Lock className="w-3.5 h-3.5 text-emerald-400" /> End-To-End Encrypted
        </span>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          ACTIVE VOICE CALL
        </div>
      </div>

      {/* Call Main Display */}
      <div className="flex flex-col items-center justify-center flex-1">
        {/* Pulsing avatar frame */}
        <div className="relative mb-6">
          <span className="absolute -inset-4 rounded-full bg-[#1f2c34] animate-pulse" />
          <img
            src={avatarUrl}
            alt={username}
            className="w-28 h-28 md:w-36 md:h-36 rounded-full border-2 border-emerald-500 relative z-10 object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Username & Timer */}
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">{username}</h2>
        <span className="text-xl font-mono text-emerald-400 font-medium tracking-wider">
          {formatDuration(callDuration)}
        </span>
      </div>

      {/* Floating Control Bar */}
      <div className="w-full max-w-sm bg-[#111b21] border border-gray-800 rounded-2xl px-6 py-4 flex items-center justify-around shadow-2xl mb-8">
        {/* Mute Control */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            id="toggle-mute-btn"
            onClick={onToggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isMuted
                ? 'bg-red-600/25 text-red-500 border border-red-500/20 hover:bg-red-600/30'
                : 'bg-[#202c33] text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5.5 h-5.5" /> : <Mic className="w-5.5 h-5.5" />}
          </button>
          <span className="text-[10px] text-gray-400">{isMuted ? 'Muted' : 'Mute'}</span>
        </div>

        {/* End Call Button */}
        <div className="flex flex-col items-center gap-1.5">
          <motion.button
            id="end-voice-call-btn"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onEndCall}
            className="w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-red-600/20 transition-all cursor-pointer"
            title="End Call"
          >
            <PhoneOff className="w-6.5 h-6.5 rotate-135" />
          </motion.button>
          <span className="text-[10px] text-gray-400">Hang Up</span>
        </div>

        {/* Speaker Mode Control */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            id="toggle-speaker-btn"
            onClick={onToggleSpeaker}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isSpeakerMode
                ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/30'
                : 'bg-[#202c33] text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
            title={isSpeakerMode ? 'Speaker Mode Off' : 'Speaker Mode On'}
          >
            {isSpeakerMode ? <Volume2 className="w-5.5 h-5.5" /> : <VolumeX className="w-5.5 h-5.5" />}
          </button>
          <span className="text-[10px] text-gray-400">{isSpeakerMode ? 'Speaker On' : 'Speaker Off'}</span>
        </div>
      </div>
    </div>
  );
};

export default ActiveVoiceCallScreen;
