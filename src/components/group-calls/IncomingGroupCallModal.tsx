import React, { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { CallRoom } from '../../types/group-call';

interface IncomingGroupCallModalProps {
  room: CallRoom;
  groupName: string;
  callerName: string;
  onAccept: (room: CallRoom) => void;
  onReject: () => void;
}

export const IncomingGroupCallModal: React.FC<IncomingGroupCallModalProps> = ({
  room,
  groupName,
  callerName,
  onAccept,
  onReject
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-play generic ringing feedback sound safely
  useEffect(() => {
    try {
      const ringSound = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-84.wav');
      ringSound.loop = true;
      audioRef.current = ringSound;
      
      const playPromise = ringSound.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.log('[GROUP-CALL] Audio autoplay was blocked by browser policies:', error);
        });
      }
    } catch (err) {
      console.warn('[GROUP-CALL] Ring audio could not be initialized:', err);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-gray-800 bg-[#111b21] p-6 shadow-2xl text-center flex flex-col items-center">
        {/* Pulsing visual circles resembling incoming ringing */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-emerald-500/20 animate-pulse" />
          <img
            src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${room.group_id}`}
            alt={groupName}
            className="relative h-20 w-20 rounded-full border border-emerald-500 bg-[#202c33] object-cover shadow-lg"
          />
        </div>

        {/* Call Info details */}
        <div className="mt-6">
          <h3 className="text-xl font-bold text-white tracking-tight">{groupName}</h3>
          <p className="mt-1 text-sm text-gray-400 font-mono">
            Group {room.call_type === 'video' ? 'Video' : 'Voice'} Call
          </p>
          <p className="mt-4 text-xs text-emerald-400 font-medium bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-500/20 inline-block">
            {callerName} is calling...
          </p>
        </div>

        {/* Accept/Decline action buttons */}
        <div className="mt-10 flex w-full justify-around items-center max-w-[240px]">
          {/* Decline button */}
          <button
            id="reject-group-call-btn"
            onClick={onReject}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            title="Decline"
          >
            <PhoneOff className="h-6 w-6 rotate-[135deg]" />
          </button>

          {/* Accept button */}
          <button
            id="accept-group-call-btn"
            onClick={() => onAccept(room)}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-900/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            title="Accept"
          >
            {room.call_type === 'video' ? (
              <Video className="h-6 w-6" />
            ) : (
              <Phone className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingGroupCallModal;
