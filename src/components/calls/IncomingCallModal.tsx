import React from 'react';
import { motion } from 'motion/react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Call, Profile } from '../../types/calls';

interface IncomingCallModalProps {
  call: Call;
  caller: Profile | null;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  call,
  caller,
  onAccept,
  onReject
}) => {
  const isVideo = call.call_type === 'video';
  const username = caller?.username || 'Unknown User';
  const avatarUrl = caller?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${call.caller_id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        id="incoming-call-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="w-full max-w-sm bg-[#1f2c34] border border-emerald-500/20 text-white rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center"
      >
        {/* Animated Pulsing Ring */}
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
          <span className="absolute -inset-2 rounded-full bg-emerald-500/10 animate-pulse" />
          <img
            src={avatarUrl}
            alt={username}
            className="w-24 h-24 rounded-full border-2 border-emerald-500 relative z-10 object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Call Info */}
        <h3 className="text-xl font-bold tracking-wide mb-1 text-white">{username}</h3>
        <p className="text-xs text-[#8696a0] font-mono tracking-wider flex items-center gap-1.5 mb-6 uppercase">
          {isVideo ? (
            <>
              <Video className="w-4 h-4 text-emerald-400" /> WhatsApp Video Call
            </>
          ) : (
            <>
              <Phone className="w-4 h-4 text-emerald-400 animate-bounce" /> WhatsApp Voice Call
            </>
          )}
        </p>

        <p className="text-sm text-[#00a884] font-medium mb-8 animate-pulse">Ringing...</p>

        {/* Call Actions */}
        <div className="flex items-center gap-10">
          {/* Decline Button */}
          <button
            id="decline-call-btn"
            onClick={onReject}
            className="w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-red-600/20 active:scale-95 transition-all cursor-pointer"
            title="Decline Call"
          >
            <PhoneOff className="w-6 h-6 rotate-135" />
          </button>

          {/* Accept Button */}
          <button
            id="accept-call-btn"
            onClick={onAccept}
            className="w-14 h-14 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
            title="Accept Call"
          >
            <Phone className="w-6 h-6 animate-pulse" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default IncomingCallModal;
