import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Minimize2,
  Maximize2,
  Volume2,
  VolumeX,
  Camera,
  Users,
  Shield,
  Clock,
  AlertCircle
} from 'lucide-react';
import { CallRoom, CallParticipant } from '../../types/group-call';

interface GroupCallScreenProps {
  activeRoom: CallRoom;
  participants: CallParticipant[];
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  callDuration: number;
  isMinimized: boolean;
  isMuted: boolean;
  isCameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  onLeaveCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onMinimize: (minimized: boolean) => void;
  currentUserId: string;
}

// Sub-component to bind and display individual media streams
const ParticipantVideoTile: React.FC<{
  stream: MediaStream | null;
  isLocal: boolean;
  username: string;
  avatarSeed: string;
  isMuted: boolean;
  cameraEnabled: boolean;
  isActiveSpeaker: boolean;
}> = ({ stream, isLocal, username, avatarSeed, isMuted, cameraEnabled, isActiveSpeaker }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => {
        console.warn('[GROUP-CALL] Video tile playback failed or was blocked:', err);
      });
    }
  }, [stream]);

  return (
    <div
      className={`relative w-full h-full bg-[#1c242c] rounded-2xl overflow-hidden border transition-all duration-300 shadow-lg ${
        isActiveSpeaker
          ? 'border-emerald-500 shadow-lg shadow-emerald-500/20'
          : 'border-gray-800'
      }`}
    >
      {/* Stream video display */}
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal} // Must mute local stream to avoid audio feedback loops
          className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''} ${!cameraEnabled ? 'hidden' : ''}`}
        />
      ) : null}

      {/* Avatar placeholder when camera is disabled */}
      {(!cameraEnabled || !stream) ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
          <div className="relative">
            {isActiveSpeaker && (
              <div className="absolute inset-0 rounded-full bg-emerald-500/15 animate-ping" />
            )}
            <img
              src={`https://api.dicebear.com/7.x/adventurer/svg?seed=${avatarSeed}`}
              alt={username}
              className={`w-20 h-20 md:w-24 md:h-24 rounded-full bg-[#202c33] border-2 object-cover relative z-10 transition-all ${
                isActiveSpeaker ? 'border-emerald-400 scale-105' : 'border-gray-700'
              }`}
            />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-200 tracking-wide text-center">
            {username} {isLocal && '(You)'}
          </p>
        </div>
      ) : null}

      {/* Mic/Camera Muted overlay badges */}
      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-1.5 border border-white/5 text-xs text-white">
        <span className="max-w-[100px] truncate">{username}</span>
        {isMuted ? (
          <MicOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
        ) : (
          <Mic className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}
      </div>

      {isActiveSpeaker && (
        <span className="absolute top-3 right-3 bg-emerald-500 text-black text-[9px] font-mono uppercase px-2 py-0.5 rounded-full font-bold animate-pulse">
          Speaking
        </span>
      )}
    </div>
  );
};

export const GroupCallScreen: React.FC<GroupCallScreenProps> = ({
  activeRoom,
  participants,
  localStream,
  remoteStreams,
  callDuration,
  isMinimized,
  isMuted,
  isCameraEnabled,
  facingMode,
  onLeaveCall,
  onEndCall,
  onToggleMute,
  onToggleCamera,
  onSwitchCamera,
  onMinimize,
  currentUserId
}) => {
  const [isSpeakerBoosted, setIsSpeakerBoosted] = useState<boolean>(true);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const prevPartsRef = useRef<CallParticipant[]>([]);

  // Format call duration to digital timer string (e.g., 03:45)
  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Push fleeting logs/toasts to active participants screen for action visibility
  const pushToast = (text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  // Watch participants array for live join/leave/mute notifications
  useEffect(() => {
    const prev = prevPartsRef.current;
    
    // Check for newcomers
    participants.forEach((p) => {
      if (p.user_id === currentUserId) return;
      const wasPresent = prev.some((prevP) => prevP.user_id === p.user_id);
      if (!wasPresent && prev.length > 0) {
        pushToast(`${p.profile?.username || 'Participant'} joined the call`);
      } else if (wasPresent) {
        const matchingPrev = prev.find((prevP) => prevP.user_id === p.user_id);
        if (matchingPrev) {
          if (matchingPrev.is_muted !== p.is_muted) {
            pushToast(`${p.profile?.username || 'Participant'} ${p.is_muted ? 'muted mic' : 'unmuted mic'}`);
          }
          if (matchingPrev.camera_enabled !== p.camera_enabled) {
            pushToast(`${p.profile?.username || 'Participant'} ${p.camera_enabled ? 'enabled camera' : 'disabled camera'}`);
          }
        }
      }
    });

    // Check for participants who left
    prev.forEach((p) => {
      const isStillPresent = participants.some((currP) => currP.user_id === p.user_id);
      if (!isStillPresent && p.user_id !== currentUserId) {
        pushToast(`${p.profile?.username || 'Participant'} left the call`);
      }
    });

    prevPartsRef.current = participants;
  }, [participants, currentUserId]);

  // Is current user the initiator/admin of this call?
  const isCallAdmin = activeRoom.created_by === currentUserId;

  // Decide how grid is sized
  // Includes local user + other active remote participants
  const totalTilesCount = 1 + remoteStreams.size;
  let gridColsClass = 'grid-cols-1 md:grid-cols-2';
  if (totalTilesCount === 1) {
    gridColsClass = 'grid-cols-1 max-w-lg mx-auto';
  } else if (totalTilesCount === 2) {
    gridColsClass = 'grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto';
  } else if (totalTilesCount <= 4) {
    gridColsClass = 'grid-cols-2 max-w-4xl mx-auto';
  } else {
    gridColsClass = 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
  }

  // MINIMIZED Floating Overlay viewport rendering
  if (isMinimized) {
    return (
      <div
        id="minimized-group-call-widget"
        className="fixed bottom-6 right-6 z-[99999] w-72 bg-[#111b21] rounded-2xl border border-emerald-500/40 p-4 shadow-2xl flex items-center justify-between gap-4 animate-scale-in"
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="relative">
            <span className="absolute -top-1 -right-1 bg-emerald-500 text-black text-[9px] font-bold px-1.5 rounded-full shrink-0">
              {participants.length}
            </span>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-xs font-semibold text-white truncate">Group Call Room</span>
            <span className="text-[10px] font-mono text-emerald-400/85 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDuration(callDuration)}
            </span>
          </div>
        </div>

        {/* Small minimized controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggleMute}
            className={`p-2 rounded-lg transition-all ${
              isMuted ? 'bg-red-500/10 text-red-400' : 'bg-gray-800 text-gray-300'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onMinimize(false)}
            className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white"
            title="Maximize"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={onLeaveCall}
            className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white"
            title="Leave"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // MAXIMIZED Full Screen Calling Overlay viewport rendering
  return (
    <div className="fixed inset-0 z-[9990] bg-[#0b141a] flex flex-col overflow-hidden text-white animate-fade-in">
      
      {/* A. Top Header bar */}
      <header className="px-6 py-4 bg-gradient-to-b from-black/50 to-transparent flex items-center justify-between shrink-0 relative z-10">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full text-[10px] font-mono tracking-widest uppercase font-semibold flex items-center gap-1 shadow-sm">
              <Shield className="w-3 h-3 text-emerald-400" /> WhatsApp Group Call
            </span>
            {isCallAdmin && (
              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider">
                Admin
              </span>
            )}
          </div>
          <h2 className="text-base md:text-lg font-bold mt-1 text-gray-100 flex items-center gap-2">
            Active Room Code <span className="font-mono text-gray-400 text-xs bg-gray-800/40 px-2 py-0.5 rounded border border-gray-700">{activeRoom.id.substring(0, 8)}</span>
          </h2>
        </div>

        {/* Info stats (duration, participant count) & minimize action */}
        <div className="flex items-center gap-3">
          <div className="bg-[#111b21]/95 border border-gray-800 rounded-2xl px-3 py-1.5 flex items-center gap-3 text-xs text-gray-300">
            <div className="flex items-center gap-1 font-mono text-emerald-400 font-semibold border-r border-gray-800 pr-3">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              {formatDuration(callDuration)}
            </div>
            <div className="flex items-center gap-1.5 font-medium">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              {participants.length} Joined
            </div>
          </div>

          <button
            onClick={() => onMinimize(true)}
            className="p-2 rounded-xl bg-gray-800/60 hover:bg-gray-800 border border-gray-700/50 text-gray-300 hover:text-white transition-all cursor-pointer"
            title="Minimize to floating window"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* B. Dynamic Overlay Log Toasts for participant updates */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-emerald-950/90 text-emerald-300 border border-emerald-500/30 px-4 py-2 rounded-xl text-xs font-medium text-center shadow-lg backdrop-blur-md"
            >
              {toast.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* C. Primary participants mesh rendering grid */}
      <main className="flex-1 px-6 py-4 flex items-center justify-center overflow-y-auto">
        <div className={`grid w-full h-full gap-4 max-h-[80vh] ${gridColsClass}`}>
          
          {/* Local Participant view tile */}
          <ParticipantVideoTile
            stream={localStream}
            isLocal={true}
            username="You"
            avatarSeed={currentUserId}
            isMuted={isMuted}
            cameraEnabled={isCameraEnabled}
            isActiveSpeaker={!isMuted}
          />

          {/* Active Remote Participants view tiles */}
          {Array.from(remoteStreams.entries()).map(([peerId, stream]) => {
            const participantRecord = participants.find((p) => p.user_id === peerId);
            const username = participantRecord?.profile?.username || 'Other Participant';
            const avatarSeed = peerId;
            const isPeerMuted = participantRecord?.is_muted ?? false;
            const isPeerCameraEnabled = participantRecord?.camera_enabled ?? true;
            
            // Assume speaking if they have audio track enabled and are not muted
            const isSpeakingCandidate = !isPeerMuted && stream.getAudioTracks().length > 0;

            return (
              <ParticipantVideoTile
                key={peerId}
                stream={stream}
                isLocal={false}
                username={username}
                avatarSeed={avatarSeed}
                isMuted={isPeerMuted}
                cameraEnabled={isPeerCameraEnabled}
                isActiveSpeaker={isSpeakingCandidate}
              />
            );
          })}

          {/* Display nice placeholder helper card if nobody has connected to WebRTC yet */}
          {remoteStreams.size === 0 && (
            <div className="flex flex-col items-center justify-center p-8 bg-[#151e24]/40 border border-gray-800/40 rounded-2xl max-w-sm mx-auto text-center col-span-full">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 animate-pulse">
                <Users className="w-6 h-6" />
              </div>
              <p className="mt-4 text-sm font-semibold text-gray-200">Waiting for others to join...</p>
              <p className="mt-1 text-xs text-gray-400">Share this group chat room with members to start the mesh session.</p>
            </div>
          )}
        </div>
      </main>

      {/* D. Floating Call Control dashboard bar */}
      <footer className="px-6 py-8 bg-gradient-to-t from-black/65 to-transparent flex justify-center shrink-0 relative z-10">
        <div className="bg-[#111b21]/95 backdrop-blur-md border border-gray-800 rounded-3xl px-6 md:px-10 py-4 flex items-center gap-4 sm:gap-6 shadow-2xl">
          
          {/* Mute/Unmute Mic Toggle */}
          <button
            onClick={onToggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isMuted
                ? 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30'
                : 'bg-[#202c33]/90 text-gray-300 hover:bg-gray-700 hover:text-white border border-transparent'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5.5 h-5.5" /> : <Mic className="w-5.5 h-5.5" />}
          </button>

          {/* Camera ON/OFF Toggle */}
          <button
            onClick={onToggleCamera}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              !isCameraEnabled
                ? 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30'
                : 'bg-[#202c33]/90 text-gray-300 hover:bg-gray-700 hover:text-white border border-transparent'
            }`}
            title={isCameraEnabled ? 'Disable camera stream' : 'Enable camera stream'}
          >
            {isCameraEnabled ? <Video className="w-5.5 h-5.5" /> : <VideoOff className="w-5.5 h-5.5" />}
          </button>

          {/* Switch Camera facing mode */}
          {isCameraEnabled && (
            <button
              onClick={onSwitchCamera}
              className="w-12 h-12 rounded-full bg-[#202c33]/90 text-gray-300 hover:bg-gray-700 hover:text-white transition-all flex items-center justify-center cursor-pointer border border-transparent"
              title="Flip camera front/back"
            >
              <Camera className="w-5.5 h-5.5" />
            </button>
          )}

          {/* Speaker Mode booster (simulated boost toggle) */}
          <button
            onClick={() => setIsSpeakerBoosted(!isSpeakerBoosted)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isSpeakerBoosted
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                : 'bg-[#202c33]/90 text-gray-400 hover:bg-gray-700 border border-transparent'
            }`}
            title={isSpeakerBoosted ? 'Speaker Boost ON' : 'Speaker Boost OFF'}
          >
            {isSpeakerBoosted ? <Volume2 className="w-5.5 h-5.5" /> : <VolumeX className="w-5.5 h-5.5" />}
          </button>

          {/* Leave Call button */}
          <button
            onClick={onLeaveCall}
            className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-900/40 cursor-pointer"
            title="Leave calling session"
          >
            <PhoneOff className="w-5.5 h-5.5" />
          </button>

          {/* End Call entirely for admin */}
          {isCallAdmin && (
            <button
              onClick={onEndCall}
              className="w-12 h-12 rounded-full bg-orange-600 hover:bg-orange-500 text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 border border-orange-500/20 shadow-lg cursor-pointer"
              title="End call for everyone"
            >
              <PhoneOff className="w-5.5 h-5.5" />
            </button>
          )}

        </div>
      </footer>
    </div>
  );
};

export default GroupCallScreen;
