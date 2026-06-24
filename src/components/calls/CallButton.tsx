import React from 'react';
import { Phone } from 'lucide-react';
import { Profile } from '../../types/calls';

interface CallButtonProps {
  contact: Profile;
  onStartCall: (contact: Profile, type: 'audio') => void;
  disabled?: boolean;
}

export const CallButton: React.FC<CallButtonProps> = ({ contact, onStartCall, disabled = false }) => {
  return (
    <button
      id={`start-voice-call-btn-${contact.id}`}
      onClick={() => onStartCall(contact, 'audio')}
      disabled={disabled}
      className={`p-2.5 rounded-full hover:bg-[#202c33] text-emerald-400 hover:text-emerald-300 transition-all ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={`Voice Call ${contact.username}`}
    >
      <Phone className="w-5 h-5" />
    </button>
  );
};

export default CallButton;
