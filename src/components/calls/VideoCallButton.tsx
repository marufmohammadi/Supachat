import React from 'react';
import { Video } from 'lucide-react';
import { Profile } from '../../types/calls';

interface VideoCallButtonProps {
  contact: Profile;
  onStartCall: (contact: Profile, type: 'video') => void;
  disabled?: boolean;
}

export const VideoCallButton: React.FC<VideoCallButtonProps> = ({ contact, onStartCall, disabled = false }) => {
  return (
    <button
      id={`start-video-call-btn-${contact.id}`}
      onClick={() => onStartCall(contact, 'video')}
      disabled={disabled}
      className={`p-2.5 rounded-full hover:bg-[#202c33] text-emerald-400 hover:text-emerald-300 transition-all ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={`Video Call ${contact.username}`}
    >
      <Video className="w-5.5 h-5.5" />
    </button>
  );
};

export default VideoCallButton;
