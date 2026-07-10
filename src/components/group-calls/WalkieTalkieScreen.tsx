import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Users,
  Shield,
  Lock,
  Unlock,
  Radio,
  Signal,
  XCircle,
  AlertTriangle,
  UserX
} from 'lucide-react';
import { WalkieTalkieParticipant } from '../../services/group-call/walkie-talkie/WalkieTalkieService';

interface WalkieTalkieScreenProps {
  groupId: string;
  groupName: string;
  isJoined: boolean;
  isConnecting: boolean;
  participants: WalkieTalkieParticipant[];
  remoteStreams: Map<string, MediaStream>;
  currentSpeaker: WalkieTalkieParticipant | null;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'connecting';
  isRoomLocked: boolean;
  isLocalForceMuted: boolean;
  currentUserRole: 'owner' | 'admin' | 'member';
  error: string | null;
  onLeave: () => void;
  onStartSpeaking: () => void;
  onStopSpeaking: () => void;
  onMuteUser: (userId: string) => void;
  onKickUser: (userId: string) => void;
  onToggleRoomLock: () => void;
  onClearError: () => void;
  currentUserId: string;
}

// Simple client-side mechanical sound generator for walkie-talkie immersion
const playPTTChirp = (type: 'press' | 'release') => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'press') {
      // Short high-pitched walkie talkie "chirp-in"
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.05);
      
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } else {
      // Slightly lower pitched "chirp-out" sign-off
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch (e) {
    console.debug('PTT chirp audio blocked or unsupported:', e);
  }
};

// Hidden sub-component to mount and play incoming remote audio streams
const WalkieTalkieAudioPlayer: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => {
        console.warn('[WALKIE-TALKIE] Remote stream playback blocked or failed:', err);
      });
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0.01, pointerEvents: 'none' }} />;
};

export const WalkieTalkieScreen: React.FC<WalkieTalkieScreenProps> = ({
  groupId,
  groupName,
  isJoined,
  isConnecting,
  participants,
  remoteStreams,
  currentSpeaker,
  connectionQuality,
  isRoomLocked,
  isLocalForceMuted,
  currentUserRole,
  error,
  onLeave,
  onStartSpeaking,
  onStopSpeaking,
  onMuteUser,
  onKickUser,
  onToggleRoomLock,
  onClearError,
  currentUserId
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const pressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stop speaking if component unmounts or leaves
  useEffect(() => {
    return () => {
      if (isPressing) {
        onStopSpeaking();
      }
    };
  }, [isPressing, onStopSpeaking]);

  const handlePressStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (isLocalForceMuted || (isRoomLocked && currentUserRole === 'member') || isConnecting) {
      return;
    }
    if (isPressing) return;

    setIsPressing(true);
    playPTTChirp('press');
    onStartSpeaking();
  };

  const handlePressEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isPressing) return;

    setIsPressing(false);
    playPTTChirp('release');
    onStopSpeaking();
  };

  const handleMouseLeave = () => {
    if (isPressing) {
      setIsPressing(false);
      playPTTChirp('release');
      onStopSpeaking();
    }
  };

  // Determine button label and styling
  const isDisabled = isLocalForceMuted || (isRoomLocked && currentUserRole === 'member') || isConnecting;
  let pttButtonLabel = 'HOLD TO TALK';
  let pttButtonColor = 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20';

  if (isConnecting) {
    pttButtonLabel = 'CONNECTING...';
    pttButtonColor = 'bg-gray-600 text-gray-300 cursor-not-allowed';
  } else if (isLocalForceMuted) {
    pttButtonLabel = 'MUTED BY ADMIN';
    pttButtonColor = 'bg-red-500/20 text-red-400 border border-red-500/30 cursor-not-allowed';
  } else if (isRoomLocked && currentUserRole === 'member') {
    pttButtonLabel = 'ROOM LOCKED';
    pttButtonColor = 'bg-amber-500/20 text-amber-400 border border-amber-500/30 cursor-not-allowed';
  } else if (isPressing) {
    pttButtonLabel = 'TRANSMITTING...';
    pttButtonColor = 'bg-emerald-600 text-white shadow-emerald-400/40 ring-4 ring-emerald-500/20 scale-95';
  }

  // Active online participants count (excluding self)
  const onlineCount = participants.length;

  return (
    <div id="walkie-talkie-overlay" className="fixed inset-0 z-50 bg-[#0b141a]/95 backdrop-blur-md text-white flex flex-col items-center justify-between select-none">
      
      {/* Play remote audio streams in the background */}
      {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
        <WalkieTalkieAudioPlayer key={peerId} stream={stream} />
      ))}

      {/* HEADER SECTION */}
      <div className="w-full max-w-lg px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0 bg-[#111b21]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
            <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-gray-100 flex items-center gap-1.5">
              Walkie-Talkie <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase font-semibold">Active</span>
            </h1>
            <p className="text-xs text-gray-400 truncate max-w-[180px]">{groupName}</p>
          </div>
        </div>

        {/* Status Indicators & Admin controls */}
        <div className="flex items-center gap-3">
          {/* Signal Quality */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400 font-mono bg-[#202c33] px-2.5 py-1 rounded-full">
            <Signal className={`w-3.5 h-3.5 ${
              connectionQuality === 'excellent' ? 'text-emerald-400' :
              connectionQuality === 'good' ? 'text-blue-400' :
              connectionQuality === 'poor' ? 'text-red-400 animate-pulse' :
              'text-gray-500'
            }`} />
            <span className="capitalize">{connectionQuality}</span>
          </div>

          {/* Admin Lock Toggle */}
          {currentUserRole !== 'member' && (
            <button
              id="walkie-talkie-lock-btn"
              onClick={onToggleRoomLock}
              className={`p-2 rounded-full transition-all cursor-pointer active:scale-95 ${
                isRoomLocked
                  ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
              title={isRoomLocked ? 'Unlock Room for Members' : 'Lock Room (Only Admins Speak)'}
            >
              {isRoomLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
          )}

          {/* Leave/Close Button */}
          <button
            id="walkie-talkie-leave-btn"
            onClick={onLeave}
            className="p-2 bg-red-600/10 text-red-400 hover:bg-red-600 hover:text-white rounded-full transition-all cursor-pointer active:scale-95"
            title="Leave Walkie-Talkie Room"
          >
            <PhoneOff className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      {/* BODY / MAIN PTT CONTROL SECTION */}
      <div className="w-full max-w-lg px-6 py-6 flex-1 flex flex-col items-center justify-center gap-8 bg-[#0b141a]">
        
        {/* Dynamic Display (Who is speaking) */}
        <div className="w-full flex flex-col items-center justify-center min-h-[160px]">
          <AnimatePresence mode="wait">
            {currentSpeaker ? (
              <motion.div
                key={currentSpeaker.userId}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center justify-center text-center"
              >
                {/* Speaker Avatar & Waves */}
                <div className="relative mb-4 flex items-center justify-center">
                  {/* Concentric sound wave circles */}
                  <div className="absolute w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 animate-ping [animation-duration:1.5s]" />
                  <div className="absolute w-32 h-32 rounded-full bg-emerald-500/5 border border-emerald-500/10 animate-ping [animation-duration:2.5s]" />
                  <div className="absolute w-40 h-40 rounded-full bg-emerald-500/5 animate-pulse [animation-duration:1s]" />

                  {/* Speaker Avatar */}
                  <img
                    src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${currentSpeaker.avatarSeed}`}
                    alt={currentSpeaker.username}
                    className="w-20 h-20 rounded-full bg-[#111b21] border-2 border-emerald-400 relative z-10 shadow-xl shadow-emerald-500/10 object-cover"
                  />
                  <div className="absolute bottom-0 right-0 z-20 bg-emerald-500 text-black p-1.5 rounded-full shadow-lg border border-[#111b21]">
                    <Volume2 className="w-4 h-4 animate-bounce" />
                  </div>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase">TRANSMITTING AUDIO</p>
                </div>
                <h3 className="text-lg font-bold text-white tracking-wide">
                  {currentSpeaker.username} {currentSpeaker.userId === currentUserId && '(You)'}
                </h3>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center text-center text-gray-500"
              >
                <div className="w-20 h-20 rounded-full bg-[#1c242c] border border-gray-800 flex items-center justify-center mb-4 text-gray-600 shadow-inner">
                  <Mic className="w-8 h-8" />
                </div>
                
                <div className="bg-gray-800/40 border border-gray-800 rounded-full px-4 py-1.5 flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-gray-600" />
                  <p className="text-xs font-mono font-semibold tracking-wider text-gray-400 uppercase">CHANNEL STANDBY</p>
                </div>
                <p className="text-xs text-gray-400 max-w-xs mt-1 leading-relaxed">
                  Hold down the PTT button below to start broadcasting your voice to everyone in this room.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Heavy Mechanical PTT Button */}
        <div className="flex flex-col items-center justify-center gap-3">
          <button
            id="walkie-talkie-ptt-btn"
            disabled={isDisabled}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handlePressStart}
            onTouchEnd={handlePressEnd}
            onTouchCancel={handlePressEnd}
            className={`w-36 h-36 rounded-full flex flex-col items-center justify-center select-none font-bold tracking-wider text-xs transition-all duration-150 relative ${pttButtonColor}`}
            style={{ touchAction: 'none' }}
          >
            {/* Glowing ring while pressing */}
            {isPressing && (
              <span className="absolute inset-0 rounded-full bg-emerald-400/20 border-2 border-emerald-400 animate-ping" />
            )}

            <div className="w-20 h-20 rounded-full bg-[#000000]/15 flex items-center justify-center mb-1 border border-white/5 shadow-inner">
              {isPressing ? (
                <Radio className="w-10 h-10 text-white animate-pulse" />
              ) : isLocalForceMuted ? (
                <MicOff className="w-10 h-10 text-red-400" />
              ) : isRoomLocked && currentUserRole === 'member' ? (
                <Lock className="w-10 h-10 text-amber-400" />
              ) : (
                <Mic className="w-10 h-10 text-black/70" />
              )}
            </div>
            <span className="font-mono text-[11px] font-extrabold">{pttButtonLabel}</span>
          </button>
          
          <p className="text-[10px] text-gray-500 font-medium tracking-wide">
            {isPressing ? 'RELEASE TO SILENCE' : 'PRESS AND HOLD MICROPHONE'}
          </p>
        </div>
      </div>

      {/* BOTTOM DRAWER / LIVE MEMBER LIST SECTION */}
      <div className="w-full max-w-lg bg-[#111b21] border-t border-gray-800 rounded-t-2xl px-6 py-4 flex flex-col h-60 shrink-0 overflow-hidden">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-300">Room Members ({onlineCount})</h2>
          </div>
          {isRoomLocked && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/10">
              <Lock className="w-3 h-3" /> Admins Only Speak
            </div>
          )}
        </div>

        {/* Participants scroll list */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {participants.map((p) => {
            const isSelf = p.userId === currentUserId;
            return (
              <div
                key={p.userId}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${
                  p.isSpeaking
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-[#182229] border-gray-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* User Avatar with Online Dot */}
                  <div className="relative">
                    <img
                      src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${p.avatarSeed}`}
                      alt={p.username}
                      className={`w-9 h-9 rounded-full bg-[#202c33] object-cover border ${
                        p.isSpeaking ? 'border-emerald-400' : 'border-gray-700'
                      }`}
                    />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#111b21]" />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gray-200">
                        {p.username} {isSelf && '(You)'}
                      </span>

                      {/* Role Badge */}
                      {p.role === 'owner' ? (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 bg-amber-500/10 text-amber-400 rounded uppercase tracking-wider border border-amber-500/10">Owner</span>
                      ) : p.role === 'admin' ? (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 bg-purple-500/10 text-purple-400 rounded uppercase tracking-wider border border-purple-500/10">Admin</span>
                      ) : (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 bg-gray-800 text-gray-400 rounded uppercase tracking-wider border border-gray-700">Member</span>
                      )}
                    </div>

                    <p className="text-[10px] text-gray-500 font-mono">
                      {p.isSpeaking ? 'Speaking...' : 'Listening'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Speaking / Muted badges */}
                  <div className="flex items-center gap-1.5">
                    {p.isSpeaking && (
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-emerald-500 text-black flex items-center gap-1 animate-pulse">
                        <Volume2 className="w-3 h-3" /> ON AIR
                      </span>
                    )}

                    {p.isMuted && (
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/10 flex items-center gap-1">
                        <MicOff className="w-3 h-3" /> MUTED
                      </span>
                    )}
                  </div>

                  {/* Admin Actions Dropdown / Panel */}
                  {currentUserRole !== 'member' && !isSelf && (
                    <div className="flex items-center gap-1 ml-2 border-l border-gray-800 pl-2">
                      {/* Admin Force Mute Toggle */}
                      {!p.isMuted && (
                        <button
                          id={`walkie-talkie-mute-${p.userId}`}
                          onClick={() => onMuteUser(p.userId)}
                          className="p-1.5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 rounded transition-all cursor-pointer"
                          title="Force Mute Participant"
                        >
                          <MicOff className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Admin Kick User */}
                      <button
                        id={`walkie-talkie-kick-${p.userId}`}
                        onClick={() => onKickUser(p.userId)}
                        className="p-1.5 hover:bg-red-500/15 text-gray-400 hover:text-red-500 rounded transition-all cursor-pointer"
                        title="Remove Participant from Room"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ERROR / NOTIFICATION TOAST OVERLAY */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-6 right-6 max-w-md mx-auto z-[99] bg-[#1a0a0f] border border-red-500/20 rounded-xl px-4 py-3 shadow-2xl flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 text-red-400 rounded-full">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-200 leading-snug">{error}</p>
              </div>
            </div>
            <button
              onClick={onClearError}
              className="text-gray-400 hover:text-white transition-all text-xs font-bold px-2 py-1 bg-gray-800/50 rounded hover:bg-gray-800 cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
