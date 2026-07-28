import React from 'react';
import { Phone, Video, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Trash2 } from 'lucide-react';
import { CallLog } from '../../types/calls';

interface CallHistoryScreenProps {
  logs: any[];
  currentUserId: string;
  onClose?: () => void;
  onStartCall: (profile: any, type: 'audio' | 'video') => void;
  onOpenChat?: (targetId: string, type: 'direct' | 'group') => void;
  searchQuery?: string;
}

export const CallHistoryScreen: React.FC<CallHistoryScreenProps> = ({
  logs,
  currentUserId,
  onClose,
  onStartCall,
  onOpenChat,
  searchQuery = '',
}) => {
  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const isCaller = log.caller_id === currentUserId;
    const otherParty = isCaller ? log.receiver : log.caller;
    const username = otherParty?.username || '';
    const q = searchQuery.toLowerCase();
    return username.toLowerCase().includes(q) || (log.call_type || '').toLowerCase().includes(q);
  });
  
  const formatDuration = (seconds: number) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#111b21] text-gray-200">
      {/* Header */}
      <div className="bg-[#202c33] px-6 py-4 flex items-center justify-between border-b border-gray-700/60">
        <div className="flex items-center gap-3">
          <PhoneCall className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Call History</h2>
        </div>
        <button
          id="close-calls-history-btn"
          onClick={onClose}
          className="text-gray-400 hover:text-white hover:bg-gray-700/40 px-3 py-1.5 rounded-lg text-sm transition-all cursor-pointer"
        >
          Back to Chats
        </button>
      </div>

      {/* Logs List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#8696a0] p-6 text-center">
            <PhoneCall className="w-12 h-12 mb-4 text-gray-600 stroke-1" />
            <p className="text-sm">No call history found.</p>
            <p className="text-xs mt-1 text-gray-500">Call histories are safely synchronized in the cloud.</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isCaller = log.caller_id === currentUserId;
            const otherParty = isCaller ? log.receiver : log.caller;
            const otherPartyId = isCaller ? log.receiver_id : log.caller_id;
            
            const username = otherParty?.username || 'Unknown Contact';
            const avatarUrl = otherParty?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${otherPartyId}`;
            
            const isVideo = log.call_type === 'video';
            const isMissed = log.status === 'missed' || log.status === 'rejected';

            return (
              <div
                key={log.id}
                id={`call-log-row-${log.id}`}
                className="flex items-center justify-between p-3.5 hover:bg-[#202c33]/60 transition-colors cursor-pointer group"
                onClick={() => {
                  if (onOpenChat && otherPartyId) {
                    onOpenChat(otherPartyId, 'direct');
                  }
                }}
              >
                {/* Left: Contact Info & Status Icon */}
                <div className="flex items-center gap-3">
                  <img
                    src={avatarUrl}
                    alt={username}
                    className="w-10 h-10 rounded-full border border-gray-700 object-cover"
                    referrerPolicy="no-referrer"
                  />
                  
                  <div className="flex flex-col">
                    <span className="font-medium text-white text-xs group-hover:text-emerald-400 transition-colors">{username}</span>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
                      {/* Incoming/Outgoing/Missed Call Log Icon */}
                      {isCaller ? (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-400" />
                      ) : isMissed ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-500" />
                      ) : (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      
                      <span className={isMissed && !isCaller ? 'text-red-400 font-medium' : ''}>
                        {isCaller ? 'Outgoing' : isMissed ? 'Missed' : 'Incoming'} {isVideo ? 'Video' : 'Voice'}
                      </span>
                      
                      <span className="text-gray-600">•</span>
                      <span className="text-[10px] text-gray-400">{formatDateTime(log.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Duration & Quick Call Action Button */}
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {log.duration > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono bg-gray-800/40 px-1.5 py-0.5 rounded">
                      <Clock className="w-3 h-3" />
                      {formatDuration(log.duration)}
                    </div>
                  )}

                  {/* Redial/Callback Buttons */}
                  <div className="flex items-center gap-1">
                    <button
                      id={`callback-audio-${log.id}`}
                      onClick={() => onStartCall(otherParty || { id: otherPartyId, username }, 'audio')}
                      className="p-2 rounded-full hover:bg-gray-700/60 text-emerald-400 hover:text-white transition-all cursor-pointer"
                      title="Callback Voice"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      id={`callback-video-${log.id}`}
                      onClick={() => onStartCall(otherParty || { id: otherPartyId, username }, 'video')}
                      className="p-2 rounded-full hover:bg-gray-700/60 text-emerald-400 hover:text-white transition-all cursor-pointer"
                      title="Callback Video"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CallHistoryScreen;
