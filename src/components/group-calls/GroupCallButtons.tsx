import React from 'react';
import { Phone, Video } from 'lucide-react';

interface GroupCallButtonsProps {
  groupId: string;
  onStartGroupCall: (groupId: string, type: 'audio' | 'video') => void;
  disabled?: boolean;
}

export const GroupCallButtons: React.FC<GroupCallButtonsProps> = ({
  groupId,
  onStartGroupCall,
  disabled = false
}) => {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button
        id={`group-voice-call-btn-${groupId}`}
        onClick={() => onStartGroupCall(groupId, 'audio')}
        disabled={disabled}
        className={`p-2 sm:p-2.5 rounded-full hover:bg-[#202c33] text-emerald-400 hover:text-emerald-300 transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'
        }`}
        title="Group Voice Call"
      >
        <Phone className="w-5 h-5" />
      </button>
      <button
        id={`group-video-call-btn-${groupId}`}
        onClick={() => onStartGroupCall(groupId, 'video')}
        disabled={disabled}
        className={`p-2 sm:p-2.5 rounded-full hover:bg-[#202c33] text-emerald-400 hover:text-emerald-300 transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'
        }`}
        title="Group Video Call"
      >
        <Video className="w-5 h-5" />
      </button>
    </div>
  );
};

export default GroupCallButtons;
