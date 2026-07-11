import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { groupSignalingService } from '../services/group-signaling';
import { Video, Phone, PhoneMissed, Users, Clock } from 'lucide-react';
import { Message } from '../types';

interface GroupCallMessageBubbleProps {
  msg: Message;
  info: {
    roomId: string;
    callType: 'audio' | 'video';
    status: 'ringing' | 'active' | 'ended';
    createdBy: string;
    duration: number;
  };
  currentUserId: string;
  currentUsername: string;
  currentUserAvatar: string;
  isSandboxMode: boolean;
  onJoin: (room: any) => Promise<void>;
  onStart: (groupId: string, callType: 'audio' | 'video') => Promise<void>;
  showDateHeader: boolean;
  currentDateStr: string;
}

export const GroupCallMessageBubble: React.FC<GroupCallMessageBubbleProps> = ({
  msg,
  info,
  currentUserId,
  currentUsername,
  currentUserAvatar,
  isSandboxMode,
  onJoin,
  onStart,
  showDateHeader,
  currentDateStr,
}) => {
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (num: number) => String(num).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  useEffect(() => {
    let active = true;

    const loadParticipants = async () => {
      if (isSandboxMode) {
        if (!active) return;
        setParticipants([
          { user_id: 'bob-key-456', profile: { username: 'Bob (Security Officer)' } },
          { user_id: 'charlie-key-789', profile: { username: 'Charlie (Developer)' } },
          { user_id: currentUserId, profile: { username: currentUsername } }
        ].slice(0, info.status === 'ended' ? 3 : 2));
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('call_participants')
          .select('*, profiles(username, avatar_url)')
          .eq('room_id', info.roomId);
        if (!error && data && active) {
          setParticipants(data.map((p: any) => ({
            user_id: p.user_id,
            joined_at: p.joined_at,
            left_at: p.left_at,
            profile: p.profiles ? {
              username: p.profiles.username,
              avatar_url: p.profiles.avatar_url
            } : { username: 'Unknown User' }
          })));
        }
      } catch (err) {
        console.warn('Error fetching group call participants:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadParticipants();

    let unsub: (() => void) | undefined;
    if (!isSandboxMode) {
      unsub = groupSignalingService.subscribeToParticipants(info.roomId, () => {
        loadParticipants();
      });
    }

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, [info.roomId, info.status, isSandboxMode, currentUserId, currentUsername]);

  const didJoin = participants.some(p => p.user_id === currentUserId);
  const isActive = info.status === 'active' || info.status === 'ringing';
  const isMissed = info.status === 'ended' && !didJoin;

  // Formatting times
  const startTime = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endTime = info.duration > 0 
    ? new Date(new Date(msg.created_at).getTime() + info.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const handleCardClick = async () => {
    if (isActive) {
      const roomObj = {
        id: info.roomId,
        group_id: msg.group_id!,
        call_type: info.callType,
        created_by: info.createdBy,
        status: info.status,
        created_at: msg.created_at
      };
      await onJoin(roomObj);
    } else {
      await onStart(msg.group_id!, info.callType);
    }
  };

  // Styles
  let cardClass = 'border bg-[#1f2c34] text-gray-200 border-[#2a3942]';
  if (isActive) {
    cardClass = 'border-2 border-emerald-500 bg-emerald-950/40 text-emerald-100 shadow-lg shadow-emerald-950/20';
  } else if (isMissed) {
    cardClass = 'border border-rose-500/50 bg-rose-950/20 text-rose-100';
  }

  const IconComponent = info.callType === 'video' ? Video : Phone;

  return (
    <div className="flex flex-col items-center my-6 w-full animate-fade-in">
      {showDateHeader && (
        <span className="px-3 py-1 text-xs text-gray-400 bg-[#182229]/80 rounded-lg mb-4 select-none uppercase tracking-wider font-semibold">
          {currentDateStr}
        </span>
      )}
      
      <button 
        id={`group-call-card-${info.roomId}`}
        onClick={handleCardClick}
        className={`w-full max-w-sm rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] text-left relative overflow-hidden ${cardClass}`}
      >
        {/* Header section with status light and main details */}
        <div className="flex items-start justify-between w-full">
          <div className="flex gap-3 items-center">
            <div className={`p-2.5 rounded-lg ${isActive ? 'bg-emerald-500/20' : isMissed ? 'bg-rose-500/20' : 'bg-gray-800'}`}>
              {isMissed ? (
                <PhoneMissed className="w-5 h-5 text-rose-400" />
              ) : (
                <IconComponent className={`w-5 h-5 ${isActive ? 'text-emerald-400' : 'text-gray-300'}`} />
              )}
            </div>
            <div>
              <h4 className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                {isActive ? (
                  <>
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Group {info.callType === 'video' ? 'Video' : 'Audio'} Call In Progress
                  </>
                ) : isMissed ? (
                  `Missed Group ${info.callType === 'video' ? 'Video' : 'Audio'} Call`
                ) : (
                  `Group ${info.callType === 'video' ? 'Video' : 'Audio'} Call`
                )}
              </h4>
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 inline" />
                {startTime} {endTime ? ` - ${endTime}` : ''}
              </p>
            </div>
          </div>

          <span className={`text-xs px-2 py-1 rounded-md font-medium ${
            isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 
            isMissed ? 'bg-rose-500/20 text-rose-300' : 'bg-gray-800 text-gray-400'
          }`}>
            {isActive ? 'JOIN' : 'RECALL'}
          </span>
        </div>

        {/* Dynamic call information */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50 text-xs text-gray-300">
          <div>
            <span className="text-gray-400 block mb-0.5">Duration</span>
            <span className="font-medium">
              {isActive ? (
                <span className="text-emerald-400 font-bold animate-pulse">Live</span>
              ) : (
                formatDuration(info.duration)
              )}
            </span>
          </div>
          <div>
            <span className="text-gray-400 block mb-0.5">Joined</span>
            <span className="font-medium flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              {participants.length}
            </span>
          </div>
        </div>

        {/* Participant list names */}
        {participants.length > 0 && (
          <div className="pt-2.5 border-t border-gray-700/50 text-xs">
            <span className="text-gray-400 block mb-1">Participants</span>
            <div className="flex flex-wrap gap-1.5">
              {participants.map((p, idx) => (
                <span 
                  key={idx} 
                  className="bg-[#2a3942]/70 text-gray-300 px-2 py-0.5 rounded-full border border-gray-700"
                >
                  {p.profile?.username || 'User'}
                </span>
              ))}
            </div>
          </div>
        )}
      </button>
    </div>
  );
};
