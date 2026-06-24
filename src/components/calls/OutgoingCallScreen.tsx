import React from 'react';
import { motion } from 'motion/react';
import { PhoneOff, Video, Phone } from 'lucide-react';
import { Call, Profile } from '../../types/calls';

interface OutgoingCallScreenProps {
  call: Call;
  recipient: Profile | null;
  onEndCall: () => void;
}

export const OutgoingCallScreen: React.FC<OutgoingCallScreenProps> = ({
  call,
  recipient,
  onEndCall
}) => {
  const isVideo = call.call_type === 'video';
  const username = recipient?.username || 'Unknown Contact';
  const avatarUrl = recipient?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${call.receiver_id}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#0b141a] text-white p-6 md:p-12">
      {/* Top Banner */}
      <div className="w-full flex justify-between items-center text-[#8696a0]">
        <span className="text-xs uppercase tracking-widest font-mono">End-To-End Encrypted</span>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Ringing...
        </div>
      </div>

      {/* Center Details */}
      <div className="flex flex-col items-center justify-center flex-1">
        {/* Profile Pic with Ring Animation */}
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping" />
          <span className="absolute -inset-4 rounded-full bg-[#111b21] border border-emerald-500/10" />
          <img
            src={avatarUrl}
            alt={username}
            className="w-28 h-28 md:w-36 md:h-36 rounded-full border-2 border-[#00a884] relative z-10 object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Text Details */}
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">{username}</h2>
        <div className="flex items-center gap-2 text-sm text-[#8696a0]">
          {isVideo ? (
            <Video className="w-4 h-4 text-emerald-400" />
          ) : (
            <Phone className="w-4 h-4 text-emerald-400" />
          )}
          <span>Placing {isVideo ? 'video' : 'voice'} call...</span>
        </div>
      </div>

      {/* Control Actions / Bottom Panel */}
      <div className="w-full flex flex-col items-center gap-6 mb-8">
        <motion.button
          id="cancel-outgoing-call-btn"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onEndCall}
          className="w-16 h-16 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-red-600/30 transition-all cursor-pointer"
          title="Cancel Call"
        >
          <PhoneOff className="w-7 h-7 rotate-135" />
        </motion.button>
        <span className="text-xs text-[#8696a0]">End Call</span>
      </div>
    </div>
  );
};

export default OutgoingCallScreen;
