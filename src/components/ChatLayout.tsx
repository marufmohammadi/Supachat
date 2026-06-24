import { useState, useEffect, useRef, FormEvent } from 'react';
import { 
  Search, Send, Lock, Plus, Users, ShieldCheck, CheckCheck, Check, LogOut, 
  Database, UserCheck, Key, Shield, AlertCircle, Info, Sparkles, Archive, Image, FileText, Globe, ArrowLeft
} from 'lucide-react';
import { supabase, testSupabaseConnection } from '../lib/supabase';
import { encryptMessage, decryptMessage, importPublicKey } from '../lib/crypto';
import { Profile, Group, Message } from '../types';
import E2EEKeyManager from './E2EEKeyManager';

// WebRTC Calling System Imports
import { PhoneCall } from 'lucide-react';
import { useCall } from '../hooks/calls/useCall';
import { CallButton } from './calls/CallButton';
import { VideoCallButton } from './calls/VideoCallButton';
import { IncomingCallModal } from './calls/IncomingCallModal';
import { OutgoingCallScreen } from './calls/OutgoingCallScreen';
import { ActiveVoiceCallScreen } from './calls/ActiveVoiceCallScreen';
import { ActiveVideoCallScreen } from './calls/ActiveVideoCallScreen';
import { CallHistoryScreen } from './calls/CallHistoryScreen';

// Group WebRTC Calling System Imports
import { useGroupCall } from '../hooks/group-call/useGroupCall';
import { GroupCallButtons } from './group-calls/GroupCallButtons';
import { IncomingGroupCallModal } from './group-calls/IncomingGroupCallModal';
import { GroupCallScreen } from './group-calls/GroupCallScreen';
import { groupSignalingService } from '../services/group-signaling';
import { CallRoom as GroupCallRoom } from '../types/group-call';

function getFriendlyDateHeader(dateStr: string): string {
  if (!dateStr) return 'Unknown Date';
  try {
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return 'Unknown Date';
    
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1: Date, d2: Date) => 
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    if (isSameDay(dateObj, today)) {
      return 'Today';
    } else if (isSameDay(dateObj, yesterday)) {
      return 'Yesterday';
    } else {
      return dateObj.toLocaleDateString([], { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
  } catch (e) {
    return 'Unknown Date';
  }
}

interface ChatLayoutProps {
  session: any;
  isSandboxMode: boolean;
  onLogout: () => void;
  onOpenDbSetup: () => void;
}

const decryptedCache: { [messageId: string]: string } = {};

export default function ChatLayout({ session, isSandboxMode, onLogout, onOpenDbSetup }: ChatLayoutProps) {
  const currentUserId = session?.user?.id;
  const currentUserEmail = session?.user?.email;
  const currentUsername = session?.user?.user_metadata?.username || currentUserEmail?.split('@')[0] || 'Me';
  const currentUserAvatar = session?.user?.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${currentUserId}`;

  // Call System State & Hook
  const [showCallHistory, setShowCallHistory] = useState(false);
  const {
    activeCall,
    callRole,
    localStream,
    remoteStream,
    isMuted,
    isCameraEnabled,
    isSpeakerMode,
    callDuration,
    callError,
    otherPartyProfile,
    callHistory,
    setCallError,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    setIsSpeakerMode,
  } = useCall({
    currentUserId,
    currentUserProfile: {
      id: currentUserId,
      username: currentUsername,
      avatar_url: currentUserAvatar
    }
  });

  // Group Call System Hooks & States
  const [activeGroupRoomForCurrentChat, setActiveGroupRoomForCurrentChat] = useState<GroupCallRoom | null>(null);
  const {
    activeRoom: activeGroupRoom,
    participants: groupParticipants,
    localStream: groupLocalStream,
    remoteStreams: groupRemoteStreams,
    callDuration: groupCallDuration,
    isMinimized: isGroupCallMinimized,
    callError: groupCallError,
    isMuted: isGroupMuted,
    isCameraEnabled: isGroupCameraEnabled,
    facingMode: groupFacingMode,
    incomingRoom: incomingGroupRoom,
    incomingGroupName,
    incomingCallerName,
    setIsMinimized: setIsGroupCallMinimized,
    setCallError: setGroupCallError,
    startGroupCall,
    joinGroupCall,
    leaveGroupCall,
    endGroupCall,
    toggleLocalMute: toggleGroupLocalMute,
    toggleLocalCamera: toggleGroupLocalCamera,
    switchCamera: switchGroupCamera,
    rejectIncomingGroupCall,
  } = useGroupCall({ currentUserId });

  // State Management
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeChat, setActiveChat] = useState<{ type: 'direct' | 'group'; id: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  
  // UI States
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showNewDirectChatModal, setShowNewDirectChatModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newDirectUser, setNewDirectUser] = useState('');
  const [hasE2EEKeys, setHasE2EEKeys] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connected' | 'checking' | 'error'>('checking');
  const [dbErrorString, setDbErrorString] = useState<string | null>(null);
  const [e2eeExplainer, setE2eeExplainer] = useState<Message | null>(null);

  // Realtime "User is typing..." States and Tracking
  const [typingUsers, setTypingUsers] = useState<{ [userId: string]: { username: string; lastActive: number } }>({});
  const typingTimeoutRef = useRef<any>(null);
  const isTypingBroadcastingRef = useRef<boolean>(false);

  // Unread message counters and instant desktop/in-app pop-up notification states
  const [unreadCounts, setUnreadCounts] = useState<{ [chatId: string]: number }>({});
  const [popupNotification, setPopupNotification] = useState<{
    id: string;
    senderName: string;
    senderAvatar: string;
    previewText: string;
    chat: { type: 'direct' | 'group'; id: string };
  } | null>(null);

  // Clear typing indicators when changing chat room
  useEffect(() => {
    setTypingUsers({});
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    isTypingBroadcastingRef.current = false;
  }, [activeChat]);

  // Sweep stale typing states (6 seconds idle limit)
  useEffect(() => {
    const sweepInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      setTypingUsers((prev) => {
        const next = { ...prev };
        for (const [userId, info] of Object.entries(next)) {
          const item = info as { username: string; lastActive: number };
          if (now - item.lastActive > 6000) {
            delete next[userId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => clearInterval(sweepInterval);
  }, []);

  // References
  const messageEndRef = useRef<HTMLDivElement>(null);
  const realtimeChannelRef = useRef<any>(null);
  const globalChannelRef = useRef<any>(null);
  const activeChatRef = useRef<any>(null);

  // Keep activeChatRef updated
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  // Real-time group call detector for current group chat
  useEffect(() => {
    if (!activeChat || activeChat.type !== 'group') {
      setActiveGroupRoomForCurrentChat(null);
      return;
    }

    // Initial fetch
    groupSignalingService.fetchActiveRoomForGroup(activeChat.id).then((room) => {
      setActiveGroupRoomForCurrentChat(room);
    });

    // Real-time listener for call_rooms updates/inserts of this group
    const channel = supabase
      .channel(`active_group_call_detector_${activeChat.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_rooms',
          filter: `group_id=eq.${activeChat.id}`
        },
        () => {
          groupSignalingService.fetchActiveRoomForGroup(activeChat.id).then((room) => {
            setActiveGroupRoomForCurrentChat(room);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChat]);

  // Keep groupsRef updated to prevent realtime subscription drop cycles
  const groupsRef = useRef<Group[]>([]);
  const lastFetchUnreadTimeRef = useRef<number>(0);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Load E2EE key status
  const checkLocalKeypair = () => {
    const pub = localStorage.getItem(`whatsapp_public_key_jwk_${currentUserId}`);
    const priv = localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`);
    setHasE2EEKeys(!!(pub && priv));
  };

  useEffect(() => {
    checkLocalKeypair();
  }, [currentUserId]);

  // Initial Sync Data
  useEffect(() => {
    if (isSandboxMode) {
      setDbStatus('connected');
      // Set up mock playground profiles and threads
      const mockProfiles: Profile[] = [
        {
          id: 'bob-key-456',
          username: 'Bob (Security Officer)',
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bob',
          public_key: '{"kty":"RSA","n":"mock-publicKey-bob-456...","e":"AQAB"}',
          created_at: new Date().toISOString()
        },
        {
          id: 'charlie-key-789',
          username: 'Charlie (Developer)',
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie',
          public_key: '{"kty":"RSA","n":"mock-publicKey-charlie-789...","e":"AQAB"}',
          created_at: new Date().toISOString()
        }
      ];

      const mockGroups: Group[] = [
        {
          id: 'crypto-group-100',
          name: 'Cybersecurity Hub (E2EE)',
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Cyber',
          created_by: 'bob-key-456',
          created_at: new Date().toISOString(),
          members_count: 3
        }
      ];

      setProfiles(mockProfiles);
      setGroups(mockGroups);

      // Preload conversation
      const preloadMessages: Message[] = [
        {
          id: 'msg-p1',
          sender_id: 'bob-key-456',
          receiver_id: currentUserId,
          encrypted_body: 'bHlpcTN4Znd6YmRlcTky... [Scrambled base64]',
          is_encrypted: true,
          created_at: new Date(Date.now() - 3600000).toISOString(),
          sender: mockProfiles[0]
        }
      ];
      setMessages(preloadMessages);
      setActiveChat({ type: 'direct', id: 'bob-key-456' });
    } else {
      // Real database fetch
      verifyDbWithRetries();
    }
  }, [isSandboxMode]);

  const verifyDbWithRetries = async () => {
    setDbStatus('checking');
    const ok = await testSupabaseConnection();
    if (ok) {
      setDbStatus('connected');
      fetchRealProfilesAndGroups();
    } else {
      setDbStatus('error');
    }
  };

  const fetchRealProfilesAndGroups = async () => {
    try {
      setDbErrorString(null);
      // 1. Fetch profiles
      const { data: pData, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .order('username');
      
      if (pError) {
        console.error('Error fetching profiles:', pError);
        setDbErrorString(`Profiles fetch failed: ${pError.message}`);
        setDbStatus('error');
        return;
      }
      
      if (pData) {
        const hasMe = pData.some((u: Profile) => u.id === currentUserId);
        if (!hasMe && currentUserId) {
          // Current user is missing (probably because trigger hasn't fired yet or were created earlier). Direct fallback write:
          const localPublicKey = localStorage.getItem(`whatsapp_public_key_jwk_${currentUserId}`) || null;
          const { error: insertErr } = await supabase
            .from('profiles')
            .insert({
              id: currentUserId,
              username: currentUsername,
              avatar_url: currentUserAvatar,
              public_key: localPublicKey
            });
          
          if (!insertErr) {
            // Re-fetch profiles so that we successfully list our newly inserted profile
            const { data: pNewData, error: pNewErr } = await supabase
              .from('profiles')
              .select('*')
              .order('username');
            if (pNewData) {
              setProfiles(pNewData.filter((u: Profile) => u.id !== currentUserId));
            } else {
              setProfiles(pData.filter((u: Profile) => u.id !== currentUserId));
            }
          } else {
            console.warn('Error inserting self profile:', insertErr.message);
            // It could be that the active insert failed, but let's show profiles we got.
            setProfiles(pData.filter((u: Profile) => u.id !== currentUserId));
          }
        } else {
          setProfiles(pData.filter((u: Profile) => u.id !== currentUserId));
        }
      }

      // 2. Fetch groups current user is a member of
      const { data: gData, error: gError } = await supabase
        .from('group_members')
        .select('groups (*)')
        .eq('user_id', currentUserId);
      if (gData) {
        const joinedGroups = gData.map((item: any) => item.groups).filter(Boolean);
        setGroups(joinedGroups);
      }

      // 3. Fetch initial unread counts across all chats
      await fetchUnreadCounts();

      // 4. Update any 'sent' direct messages to 'delivered' because we are now online
      try {
        console.log(`[AUDIT] Startup Delivery sweep triggered. Receiver ID: ${currentUserId}`);
        const { data, error } = await supabase
          .from('messages')
          .update({ status: 'delivered', delivered_at: new Date().toISOString() })
          .eq('receiver_id', currentUserId)
          .or('status.eq.sent,status.is.null')
          .select();
        
        if (error) {
          console.error('[AUDIT] Startup Delivery sweep query failed:', error);
        } else {
          console.log('[AUDIT] Startup Delivery sweep query succeeded:', {
            ReceiverID: currentUserId,
            UpdatedCount: data?.length,
            UpdatedMessages: data
          });
        }
      } catch (delErr) {
        console.warn('Could not update pending message delivery statuses:', delErr);
      }
    } catch (err) {
      console.error('Failed to sync profile tables:', err);
    }
  };

  // Room ID generator to ensure direct chat partners bind to the exact same channel room
  const getRoomId = (uid: string, chat: { type: 'direct' | 'group'; id: string }): string => {
    if (chat.type === 'group') {
      return `group-${chat.id}`;
    }
    const sortedIds = [uid, chat.id].sort();
    return `direct-${sortedIds.join('-')}`;
  };

  // Mark all unread messages in database as read or updated last_read_at
  const markChatAsRead = async (chatId: string, type: 'direct' | 'group') => {
    if (isSandboxMode || !currentUserId) {
      setUnreadCounts(prev => ({ ...prev, [chatId]: 0 }));
      return;
    }
    try {
      if (type === 'direct') {
        console.log(`[AUDIT] receiver opens chat (direct):`, {
          ReceiverID: currentUserId,
          SenderID: chatId,
          Query: `UPDATE messages SET status='read', read_at=now() WHERE sender_id=${chatId} AND receiver_id=${currentUserId} AND status != 'read'`
        });

        const { data, error } = await supabase
          .from('messages')
          .update({ status: 'read', read_at: new Date().toISOString() })
          .eq('sender_id', chatId)
          .eq('receiver_id', currentUserId)
          .or('status.eq.sent,status.eq.delivered,status.is.null')
          .select();

        if (error) {
          console.error(`[AUDIT] markChatAsRead (direct) query failed:`, error);
        } else {
          console.log(`[AUDIT] markChatAsRead (direct) query result completed:`, {
            ReceiverID: currentUserId,
            SenderID: chatId,
            UpdatedMessagesCount: data?.length,
            UpdatedMessages: data
          });
        }
      } else {
        console.log(`[AUDIT] receiver opens chat (group):`, {
          ReceiverID: currentUserId,
          GroupID: chatId,
          Query: `UPDATE group_members SET last_read_at=now() WHERE group_id=${chatId} AND user_id=${currentUserId}`
        });

        const { data, error } = await supabase
          .from('group_members')
          .update({ last_read_at: new Date().toISOString() })
          .eq('group_id', chatId)
          .eq('user_id', currentUserId)
          .select();

        if (error) {
          console.error(`[AUDIT] markChatAsRead (group) query failed:`, error);
        } else {
          console.log(`[AUDIT] markChatAsRead (group) query result completed:`, {
            ReceiverID: currentUserId,
            GroupID: chatId,
            UpdatedMembersCount: data?.length,
            UpdatedRecords: data
          });
        }
      }
      setUnreadCounts(prev => ({ ...prev, [chatId]: 0 }));
    } catch (err) {
      console.warn('Could not mark chat messages as read:', err);
    }
  };

  // Fetch all unread counts for Direct and Group messages
  const fetchUnreadCounts = async () => {
    if (isSandboxMode || !currentUserId) return;
    const fetchTime = Date.now();
    lastFetchUnreadTimeRef.current = fetchTime;

    try {
      const counts: { [id: string]: number } = {};

      // 1. Direct message unreads (receiver_id is me, status is not read or is null)
      let dmData: any[] | null = null;
      let dmError = null;

      try {
        const res = await supabase
          .from('messages')
          .select('sender_id')
          .eq('receiver_id', currentUserId)
          .or('status.neq.read,status.is.null');
        dmData = res.data;
        dmError = res.error;
      } catch (err) {
        dmError = err;
      }

      if (dmError) {
        console.warn('[AUDIT] fetchUnreadCounts (direct) query failed, trying client-side fallback:', dmError);
        // Fallback: If status column is missing or query fails, fetch direct messages and compare with client's last-read timestamp
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('messages')
          .select('sender_id, created_at')
          .eq('receiver_id', currentUserId);

        if (!fallbackError && fallbackData) {
          fallbackData.forEach((msg: any) => {
            const lastReadTimeStr = localStorage.getItem(`whatsapp_last_read_direct_${currentUserId}_${msg.sender_id}`);
            const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;
            const msgTime = new Date(msg.created_at).getTime();
            if (msgTime > lastReadTime) {
              counts[msg.sender_id] = (counts[msg.sender_id] || 0) + 1;
            }
          });
        }
      } else if (dmData) {
        dmData.forEach((m: any) => {
          counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
        });
      }

      // 2. Group channel unreads (messages created_at > last_read_at for group_members)
      const { data: memberData, error: memberError } = await supabase
        .from('group_members')
        .select('group_id, last_read_at')
        .eq('user_id', currentUserId);

      if (memberError) {
        console.error('[AUDIT] fetchUnreadCounts (groups) query failed:', memberError);
      }

      if (memberData) {
        // Run all group unread calculations concurrently in parallel
        const promises = memberData.map(async (member) => {
          try {
            const { data: groupMsgDesc } = await supabase
              .from('messages')
              .select('id')
              .eq('group_id', member.group_id)
              .neq('sender_id', currentUserId)
              .gt('created_at', member.last_read_at || new Date(0).toISOString());

            if (groupMsgDesc) {
              counts[member.group_id] = groupMsgDesc.length;
            }
          } catch (mErr) {
            console.warn('Failed tracking unread for group:', member.group_id, mErr);
          }
        });
        await Promise.all(promises);
      }

      // Verify that this query remains the most recently dispatched call to avoid out-of-order updates
      if (fetchTime === lastFetchUnreadTimeRef.current) {
        console.log('[AUDIT] Unread counts calculated successfully:', {
          UserID: currentUserId,
          PreviousCounts: unreadCounts,
          NewCounts: counts
        });
        setUnreadCounts(counts);
      } else {
        console.log('[AUDIT] Discarding stale fetchUnreadCounts results to avoid blinking/flickering.');
      }
    } catch (err) {
      console.error('Failed fetching unread counts:', err);
    }
  };

  // Updates status (delivered / read) for a single received message
  const updateMessageStatus = async (msgId: string, status: 'delivered' | 'read') => {
    if (isSandboxMode) return;
    try {
      const updateData: any = { status };
      const now = new Date().toISOString();
      if (status === 'delivered') {
        updateData.delivered_at = now;
      } else if (status === 'read') {
        updateData.delivered_at = now;
        updateData.read_at = now;
      }

      console.log(`[AUDIT] Receiver updates message delivery state in db:`, {
        ReceiverID: currentUserId,
        MessageID: msgId,
        TargetStatus: status,
        QueryPayload: updateData
      });

      const { data, error } = await supabase
        .from('messages')
        .update(updateData)
        .eq('id', msgId)
        .select();

      if (error) {
        console.error(`[AUDIT] updateMessageStatus failed in db:`, error);
      } else {
        console.log(`[AUDIT] updateMessageStatus succeeded in db:`, {
          ReceiverID: currentUserId,
          MessageID: msgId,
          TargetStatus: status,
          UpdatedRows: data
        });
      }
    } catch (err) {
      console.warn('Could not update message delivery state in db:', err);
    }
  };

  // Decrypts preview text for popups silently
  const decryptPreviewText = async (msg: Message) => {
    if (!msg.is_encrypted) return msg.encrypted_body;
    if (isSandboxMode) {
      return (msg as any).decryptedText || '🔒 E2EE Ciphertext';
    }

    const myPrivateKeyJWK = localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`);
    if (!myPrivateKeyJWK) return '🔒 E2EE Message (Client Key Missing)';

    const encryptedKey = msg.sender_id === currentUserId 
      ? msg.sender_encrypted_key 
      : msg.receiver_encrypted_key;

    if (!encryptedKey) return msg.encrypted_body;

    try {
      return await decryptMessage(msg.encrypted_body, encryptedKey, myPrivateKeyJWK);
    } catch {
      return '🔒 Message Decryption Key mismatch';
    }
  };

  // Triggers desktop browser push and in-app popup notifications
  const triggerNotificationPopup = async (msg: Message) => {
    let name = 'Secured Client';
    let avatar = 'https://api.dicebear.com/7.x/adventurer/svg?seed=Unknown';
    let chatTarget: { type: 'direct' | 'group'; id: string };

    let senderProfile = profiles.find(item => item.id === msg.sender_id);
    if (!senderProfile && !isSandboxMode && msg.sender_id) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', msg.sender_id)
          .single();
        if (data) {
          senderProfile = data;
          setProfiles(prev => {
            if (!prev.some(p => p.id === data.id)) {
              return [...prev, data];
            }
            return prev;
          });
        }
      } catch (err) {
        console.warn('Could not fetch notification sender profile:', err);
      }
    }

    if (msg.group_id) {
      const g = groups.find(item => item.id === msg.group_id);
      const groupName = g ? g.name : 'Secure Group Chat';
      const senderNick = senderProfile ? senderProfile.username : 'Secured Client';
      name = `${senderNick} @ ${groupName}`;
      avatar = senderProfile?.avatar_url || g?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${msg.group_id}`;
      chatTarget = { type: 'group', id: msg.group_id };
    } else {
      const senderNick = senderProfile ? senderProfile.username : 'Private Contact';
      name = senderNick;
      avatar = senderProfile?.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${msg.sender_id}`;
      chatTarget = { type: 'direct', id: msg.sender_id };
    }

    // Support simulated reply details for sandbox notifications:
    if (isSandboxMode && msg.sender) {
      name = msg.sender.username;
      avatar = msg.sender.avatar_url;
    }

    const decrypted = await decryptPreviewText(msg);

    console.log('[AUDIT] triggerNotificationPopup invoked:', {
      MessageID: msg.id,
      SenderID: msg.sender_id,
      SenderName: name,
      IsEncrypted: msg.is_encrypted,
      DecryptedLength: decrypted?.length,
      NotificationPermStatus: 'Notification' in window ? Notification.permission : 'unsupported'
    });

    // Update in-app stateful toast overlay
    setPopupNotification({
      id: `p-notif-${Date.now()}`,
      senderName: name,
      senderAvatar: avatar,
      previewText: decrypted,
      chat: chatTarget
    });

    // Native desktop browser notification trigger with Service Worker registration fallback for minimized states
    if ('Notification' in window && Notification.permission === 'granted') {
      const title = name;
      const options = {
        body: decrypted.substring(0, 100) + (decrypted.length > 100 ? '...' : ''),
        icon: avatar,
        badge: avatar,
        tag: msg.group_id || msg.sender_id,
        renotify: true
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, options);
          console.log('[AUDIT] SW Push notification triggered:', { messageId: msg.id, senderName: name });
        }).catch((err) => {
          new Notification(title, options);
          console.log('[AUDIT] Regular native notification triggered (sw fallback):', { messageId: msg.id, senderName: name, err });
        });
      } else {
        new Notification(title, options);
        console.log('[AUDIT] Standard native window notification triggered:', { messageId: msg.id, senderName: name });
      }
    } else {
      console.log('[AUDIT] Browser push notification skipped: permission is not granted or supported');
    }

    // Auto dismiss after 5 seconds
    setTimeout(() => {
      setPopupNotification(prev => {
        if (prev && prev.chat.id === chatTarget.id) {
          return null;
        }
        return prev;
      });
    }, 5000);
  };

  const handleNotificationClick = () => {
    if (popupNotification) {
      setActiveChat(popupNotification.chat);
      setPopupNotification(null);
    }
  };

  // Switch Active Chats & Load Messages
  useEffect(() => {
    if (!activeChat) return;
    setMessages([]);

    if (isSandboxMode) {
      // Sandbox mode mock chat loading
      if (activeChat.type === 'direct' && activeChat.id === 'bob-key-456') {
        const dummyMsgs: Message[] = [
          {
            id: 'm-direct-1',
            sender_id: 'bob-key-456',
            receiver_id: currentUserId,
            encrypted_body: 'Welcome to E2EE Chat! Feel free to write anything. The message you send to me will be hybrid-encrypted on your computer using my RSA-2048 public key before passing through any servers!',
            is_encrypted: true,
            created_at: new Date(Date.now() - 60000).toISOString(),
            status: 'read'
          }
        ];
        (dummyMsgs[0] as any).decryptedText = 'Welcome to E2EE Chat! Feel free to write anything. The message you send to me will be hybrid-encrypted on your computer using my RSA-2048 public key before passing through any servers!';
        setMessages(dummyMsgs);
      } else if (activeChat.type === 'group' && activeChat.id === 'crypto-group-100') {
        const dummyMsgs: Message[] = [
          {
            id: 'm-group-1',
            sender_id: 'bob-key-456',
            group_id: 'crypto-group-100',
            encrypted_body: 'Welcome to the Cybersecurity Hub! We share ideas about security audits and E2E keys here.',
            is_encrypted: true,
            created_at: new Date(Date.now() - 120000).toISOString(),
            status: 'read'
          },
          {
            id: 'm-group-2',
            sender_id: 'charlie-key-789',
            group_id: 'crypto-group-100',
            encrypted_body: 'Our group chats are linked with encrypted signatures too. Pretty neat.',
            is_encrypted: true,
            created_at: new Date(Date.now() - 80000).toISOString(),
            status: 'read'
          }
        ];
        (dummyMsgs[0] as any).decryptedText = 'Welcome to the Cybersecurity Hub! We share ideas about security audits and E2E keys here.';
        (dummyMsgs[1] as any).decryptedText = 'Our group chats are linked with encrypted signatures too. Pretty neat.';
        setMessages(dummyMsgs);
      }
    } else {
      // Real database message query & mark read
      markChatAsRead(activeChat.id, activeChat.type).then(() => {
        fetchChatMessages();
        subscribeToTypingChannel();
        fetchUnreadCounts();
      });
    }
  }, [activeChat, isSandboxMode]);

  const fetchChatMessages = async () => {
    if (!activeChat) return;
    try {
      let query = supabase.from('messages').select('*, sender:profiles!sender_id(*), receiver:profiles!receiver_id(*)');

      if (activeChat.type === 'direct') {
        // Direct messages where sender and receiver form the pair
        query = query.or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${currentUserId})`
        );
      } else {
        // Group messages
        query = query.eq('group_id', activeChat.id);
      }

      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw error;
      if (data) {
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  // Global message and delivery/read updates subscription
  useEffect(() => {
    if (isSandboxMode || !currentUserId) return;

    if (globalChannelRef.current) {
      globalChannelRef.current.unsubscribe();
    }

    console.log('[AUDIT] Initializing Global Realtime Subscription...');

    const channel = supabase
      .channel(`global-user-messages-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
        },
        async (payload) => {
          console.log('[AUDIT] Realtime Database Event Received:', {
            event_type: payload.eventType,
            msg_id: (payload.new as any)?.id,
            msg_status: (payload.new as any)?.status,
            sender_id: (payload.new as any)?.sender_id,
            receiver_id: (payload.new as any)?.receiver_id
          });
          
          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as Message;
            if (!newMsg) return;

            const isFromMe = newMsg.sender_id === currentUserId;
            const currentActiveChat = activeChatRef.current;

            // Verify if message matches current active thread
            const isForActiveChat = currentActiveChat && (
              (currentActiveChat.type === 'direct' && 
                ((newMsg.sender_id === currentUserId && newMsg.receiver_id === currentActiveChat.id) ||
                 (newMsg.sender_id === currentActiveChat.id && newMsg.receiver_id === currentUserId))) ||
              (currentActiveChat.type === 'group' && newMsg.group_id === currentActiveChat.id)
            );

            if (isForActiveChat) {
              if (!isFromMe) {
                // Currently reading! Update status to 'read' (Read Event)
                console.log('[AUDIT] Message matching ACTIVE conversation received: target message id:', newMsg.id, 'status:', newMsg.status, '- Triggering READ update');
                if (currentActiveChat.type === 'direct') {
                  updateMessageStatus(newMsg.id, 'read');
                } else {
                  markChatAsRead(currentActiveChat.id, 'group');
                }
              }

              // Match cache with plain text body if sent by us
              if (isFromMe && newMsg.encrypted_body) {
                const cachedText = decryptedCache[newMsg.encrypted_body];
                if (cachedText) {
                  decryptedCache[newMsg.id] = cachedText;
                }
              }

              // Append new message or replace optimistic placeholder
              setMessages(prev => {
                const exists = prev.some(m => m.id === newMsg.id);
                if (exists) return prev;

                const optIndex = prev.findIndex(m => m.id.startsWith('opt-') && m.encrypted_body === newMsg.encrypted_body);
                if (optIndex !== -1) {
                  const next = [...prev];
                  next[optIndex] = { ...newMsg, status: isFromMe ? newMsg.status : 'read' };
                  return next;
                }
                return [...prev, { ...newMsg, status: isFromMe ? newMsg.status : 'read' }];
              });

            } else {
              // Not viewing this chat room right now
              if (!isFromMe) {
                const isSentToMe = newMsg.receiver_id === currentUserId || 
                  (newMsg.group_id && groupsRef.current.some(g => g.id === newMsg.group_id));

                if (isSentToMe) {
                  // Direct Delivery Event (Delivery Event)
                  console.log('[AUDIT] Message matching BACKGROUND conversation received: message id:', newMsg.id, 'status:', newMsg.status, '- Triggering DELIVERED update');
                  updateMessageStatus(newMsg.id, 'delivered');
                  
                  // Increment unread locally
                  const targetId = newMsg.group_id || newMsg.sender_id;
                  setUnreadCounts(prev => ({
                    ...prev,
                    [targetId]: (prev[targetId] || 0) + 1
                  }));
                  fetchUnreadCounts();
                  triggerNotificationPopup(newMsg);
                }
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as Message;
            if (!updatedMsg) return;

            // Realtime status event logger
            console.log('[AUDIT] Realtime status UPDATE received: message ID:', updatedMsg.id, 'updated status is:', updatedMsg.status);

            // Since replica identity may omit unmodified columns during update events,
            // we merge only status/timestamp fields to avoid overwriting valid metadata with nulls.
            // We also support resolving optimistic placeholders to prevent race conditions.
            setMessages(prev => {
              const exists = prev.some(m => m.id === updatedMsg.id || (m.id.startsWith('opt-') && m.encrypted_body === updatedMsg.encrypted_body));
              if (exists) {
                return prev.map(m => {
                  const match = m.id === updatedMsg.id || (m.id.startsWith('opt-') && m.encrypted_body === updatedMsg.encrypted_body);
                  if (match) {
                    return {
                      ...m,
                      id: updatedMsg.id, // Adopts actual UUID
                      status: updatedMsg.status || m.status,
                      delivered_at: updatedMsg.delivered_at || m.delivered_at,
                      read_at: updatedMsg.read_at || m.read_at
                    };
                  }
                  return m;
                });
              }
              return prev;
            });
            
            // Re-fetch counts when delivery or read statuses change across the system
            fetchUnreadCounts();
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[AUDIT] Global Realtime Channel subscription state:', status, err || '');
      });

    globalChannelRef.current = channel;

    return () => {
      if (globalChannelRef.current) {
        console.log('[AUDIT] Cleaning up Global Realtime Channel Subscription...');
        globalChannelRef.current.unsubscribe();
      }
    };
  }, [currentUserId, isSandboxMode]);

  // Realtime "typing" broadcasts setup
  const subscribeToTypingChannel = () => {
    if (realtimeChannelRef.current) {
      realtimeChannelRef.current.unsubscribe();
    }
    if (!activeChat) return;

    const roomId = getRoomId(currentUserId, activeChat);
    const channel = supabase
      .channel(`typing-${roomId}`)
      .on(
        'broadcast',
        { event: 'typing' },
        (payload) => {
          const { userId, username, isTyping } = payload.payload || {};
          if (!userId || userId === currentUserId) return;

          setTypingUsers((prev) => {
            const next = { ...prev };
            if (isTyping) {
              next[userId] = { username, lastActive: Date.now() };
            } else {
              delete next[userId];
            }
            return next;
          });
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;
  };

  // Cleanup realtime listeners
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) {
        realtimeChannelRef.current.unsubscribe();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Request desktop/mobile notification permission at startup & Register Service Worker
  useEffect(() => {
    console.log('[AUDIT] notification setup - Checking Browser Permissions:', {
      NotificationSupported: 'Notification' in window,
      CurrentPermission: 'Notification' in window ? Notification.permission : 'Not Supported',
      ServiceWorkerSupported: 'serviceWorker' in navigator,
      SandboxActive: isSandboxMode
    });

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        console.log('[AUDIT] notification setup - Permission request prompt resolved:', perm);
      });
    }

    if ('serviceWorker' in navigator && !isSandboxMode) {
      console.log('[AUDIT] notification setup - Registering Service Worker...');
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[AUDIT] notification setup - Service Worker registered successfully:', {
            scope: reg.scope,
            active: !!reg.active,
            waiting: !!reg.waiting,
            installing: !!reg.installing
          });
        })
        .catch((err) => {
          console.warn('[AUDIT] notification setup - Service Worker registration failed:', err);
        });
    }
  }, [isSandboxMode]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Input Changes & Broadcast Typing Status
  const handleInputChange = (val: string) => {
    setInputMessage(val);
    
    if (isSandboxMode) return;
    if (!realtimeChannelRef.current || !activeChat) return;

    if (!isTypingBroadcastingRef.current && val.trim().length > 0) {
      isTypingBroadcastingRef.current = true;
      realtimeChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: currentUserId,
          username: currentUsername,
          isTyping: true
        }
      });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingBroadcastingRef.current && realtimeChannelRef.current) {
        realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'typing',
          payload: {
            userId: currentUserId,
            username: currentUsername,
            isTyping: false
          }
        });
      }
      isTypingBroadcastingRef.current = false;
    }, 4000); // Stop typing after 4 seconds of idle time
  };

  // Handle Sending a Message
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !activeChat) return;

    const originalText = inputMessage.trim();
    setInputMessage('');

    // Immediately stop sending active typing broadcast events
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (isTypingBroadcastingRef.current && realtimeChannelRef.current) {
      realtimeChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: currentUserId,
          username: currentUsername,
          isTyping: false
        }
      });
    }
    isTypingBroadcastingRef.current = false;

    if (isSandboxMode) {
      // SIMULATOR MODE
      const newMsg: Message = {
        id: `m-sand-${Date.now()}`,
        sender_id: currentUserId,
        receiver_id: activeChat.type === 'direct' ? activeChat.id : null,
        group_id: activeChat.type === 'group' ? activeChat.id : null,
        encrypted_body: `🔒 [AES-GCM-256 Ciphertext]: ${window.btoa(originalText).substring(0, 32)}...`,
        is_encrypted: true,
        created_at: new Date().toISOString(),
        status: 'sent',
        sender: {
          id: currentUserId,
          username: currentUsername,
          avatar_url: currentUserAvatar,
          created_at: new Date().toISOString()
        }
      };

      // Set the decrypted text helper in the sandbox state so user can play
      (newMsg as any).decryptedText = originalText;
      (newMsg as any).simulatedRawCipher = window.btoa(`SALT::AES-GCM::${originalText}`);

      setMessages(prev => [...prev, newMsg]);

      // Simulate live tick state transitions matching WhatsApp:
      // 1. Sent (instant)
      // 2. Delivered (after 400ms)
      setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...m, status: 'delivered' } : m));
      }, 400);

      // Determine dynamic sandbox reply sender details based on selected chat
      const replySenderId = activeChat.type === 'direct' ? activeChat.id : 'bob-key-456';
      const replySenderName = activeChat.type === 'direct'
        ? (activeChat.id === 'bob-key-456' ? 'Bob (Security Officer)' : 'Charlie (Developer)')
        : 'Bob (Security Officer)';
      const replySenderAvatar = activeChat.type === 'direct'
        ? (activeChat.id === 'bob-key-456' ? 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bob' : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie')
        : 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bob';

      // Start "typing" simulation for the reply sender
      setTypingUsers(prev => ({
        ...prev,
        [replySenderId]: { username: replySenderName, lastActive: Date.now() }
      }));

      // 3. Seen/Read (after 1200ms)
      setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === newMsg.id ? { ...m, status: 'read' } : m));
      }, 1200);

      // Trigger automatic simulated reply
      setTimeout(() => {
        // Clear active typing simulation
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[replySenderId];
          return next;
        });

        const replyText = activeChat.type === 'direct' 
          ? `Hello there! I just received your message containing: "${originalText}". Because you activated end-to-end encryption, my browser downloaded your public key and successfully ran it through the RSA-OAEP hybrid decryptor!`
          : `Group notification: ${currentUsername} just posted a secure encrypted message!`;
        const replyMsg: Message = {
          id: `m-sand-reply-${Date.now()}`,
          sender_id: replySenderId,
          receiver_id: currentUserId,
          encrypted_body: `🔒 [Reply Ciphertext]: ${window.btoa(replyText).substring(0, 32)}...`,
          is_encrypted: true,
          created_at: new Date().toISOString(),
          status: 'read',
          sender: {
            id: replySenderId,
            username: replySenderName,
            avatar_url: replySenderAvatar,
            created_at: new Date().toISOString()
          }
        };
        (replyMsg as any).decryptedText = replyText;
        (replyMsg as any).simulatedRawCipher = window.btoa(`SALT::AES-GCM::${replyText}`);

        setMessages(prev => [...prev, replyMsg]);
        triggerNotificationPopup(replyMsg);
      }, 1500);

    } else {
      // REAL SUPABASE E2EE MESSAGING FLOW
      try {
        let encryptedBody = originalText;
        let senderEncryptedKey = null;
        let receiverEncryptedKey = null;
        let isEncrypted = false;

        if (activeChat.type === 'direct') {
          // Fetch receiver's public key
          const { data: recProfile } = await supabase
            .from('profiles')
            .select('public_key')
            .eq('id', activeChat.id)
            .single();

          const myPublicKeyJWK = localStorage.getItem(`whatsapp_public_key_jwk_${currentUserId}`);
          const myPrivateKeyJWK = localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`);

          if (recProfile?.public_key && myPublicKeyJWK && myPrivateKeyJWK) {
            // Both sides have valid cryptographic parameters -> Encrypt Hybridly!
            const recipients: { [id: string]: string } = {};
            recipients[currentUserId] = myPublicKeyJWK; // Encrypt for myself (so I can decode my sent log)
            recipients[activeChat.id] = recProfile.public_key; // Encrypt for partner

            const e2eResult = await encryptMessage(originalText, recipients);
            
            encryptedBody = e2eResult.encryptedBody;
            senderEncryptedKey = e2eResult.encryptedKeys[currentUserId];
            receiverEncryptedKey = e2eResult.encryptedKeys[activeChat.id];
            isEncrypted = true;
          }
        }

        // Optimize: Generate a local stable unique temporary ID
        const optId = `opt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const optimisticMsg: Message = {
          id: optId,
          sender_id: currentUserId,
          receiver_id: activeChat.type === 'direct' ? activeChat.id : null,
          group_id: activeChat.type === 'group' ? activeChat.id : null,
          encrypted_body: encryptedBody,
          sender_encrypted_key: senderEncryptedKey,
          receiver_encrypted_key: receiverEncryptedKey,
          is_encrypted: isEncrypted,
          created_at: new Date().toISOString(),
          status: 'sent',
        };

        // Instantly cache the decrypted text under the optimistic ID and ciphertext body!
        decryptedCache[optId] = originalText;
        decryptedCache[encryptedBody] = originalText;

        // Append to state immediately for sub-millisecond local feedback
        setMessages(prev => [...prev, optimisticMsg]);

        // Dispatch write to database in the background
        console.log('[DEBUG] Dispatching message insert to database...', {
          temporary_optimistic_id: optId,
          recipient: activeChat.type === 'direct' ? activeChat.id : null,
          group_recipient: activeChat.type === 'group' ? activeChat.id : null,
          initial_fired_status: 'sent',
          is_encrypted: isEncrypted
        });

        supabase.from('messages').insert({
          sender_id: currentUserId,
          receiver_id: activeChat.type === 'direct' ? activeChat.id : null,
          group_id: activeChat.type === 'group' ? activeChat.id : null,
          encrypted_body: encryptedBody,
          sender_encrypted_key: senderEncryptedKey,
          receiver_encrypted_key: receiverEncryptedKey,
          is_encrypted: isEncrypted,
          status: 'sent'
        }).then(({ error }) => {
          if (error) {
            console.error('Failed to save message asynchronously:', error);
            // Revert optimistic bubble if writing failed
            setMessages(prev => prev.filter(m => m.id !== optId));
            alert('Your message could not be sent. Please check database tables and replication triggers.');
          }
        });

      } catch (err: any) {
        console.error('Failed to send encrypted message:', err);
        alert('Could not dispatch message. Ensure your keys are fully generated.');
      }
    }
  };

  // Decrypts individual message client-side
  const getRenderableMessageContent = (msg: Message) => {
    if (!msg.is_encrypted) return msg.encrypted_body;

    if (isSandboxMode) {
      return (msg as any).decryptedText || msg.encrypted_body;
    }

    // Direct Message Decryption
    const myPrivateKeyJWK = localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`);
    if (!myPrivateKeyJWK) {
      return '🔒 Message Encrypted (Local Private key missing)';
    }

    // Determine correct encrypted key depending on roles
    const encryptedKey = msg.sender_id === currentUserId 
      ? msg.sender_encrypted_key 
      : msg.receiver_encrypted_key;

    if (!encryptedKey) {
      return msg.encrypted_body; // Fallback to raw if key was not assigned
    }

    // Return decrypt status asynchronously (we will lazy decode or hold decrypt states)
    return null; 
  };

  // We will build a small stateful hook/component to render decryptions cleanly
  const DecryptedBubble = ({ msg }: { msg: Message }) => {
    const [text, setText] = useState<string>(() => {
      if (!msg.is_encrypted) return msg.encrypted_body;
      if (decryptedCache[msg.id]) return decryptedCache[msg.id];
      if (decryptedCache[msg.encrypted_body]) return decryptedCache[msg.encrypted_body];
      if (isSandboxMode) return (msg as any).decryptedText || msg.encrypted_body;
      return '';
    });
    const [rawCipher, setRawCipher] = useState<string>('');

    useEffect(() => {
      async function decrypt() {
        if (!msg.is_encrypted) {
          setText(msg.encrypted_body);
          return;
        }

        if (isSandboxMode) {
          const dt = (msg as any).decryptedText || msg.encrypted_body;
          decryptedCache[msg.id] = dt;
          setText(dt);
          setRawCipher((msg as any).simulatedRawCipher || 'MOCK_CIPHERTEXT_AES_GCM_SANDBOX');
          return;
        }

        // Real decryption
        const myPrivateKeyJWK = localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`);
        if (!myPrivateKeyJWK) {
          setText('🔒 Encrypted Message (Generate E2EE keys to view)');
          setRawCipher(msg.encrypted_body);
          return;
        }

        const encryptedKey = msg.sender_id === currentUserId 
          ? msg.sender_encrypted_key 
          : msg.receiver_encrypted_key;

        if (!encryptedKey) {
          // If no key was saved, was it unencrypted before keys were set?
          setText(msg.encrypted_body);
          return;
        }

        try {
          const decrypted = await decryptMessage(msg.encrypted_body, encryptedKey, myPrivateKeyJWK);
          decryptedCache[msg.id] = decrypted;
          decryptedCache[msg.encrypted_body] = decrypted;
          setText(decrypted);
          setRawCipher(msg.encrypted_body);
        } catch (err) {
          setText('🔒 Decryption Error: Key mismatch.');
        }
      }

      decrypt();
    }, [msg, currentUserId]);

    return (
      <div className="space-y-1">
        <p className="text-[14px] text-gray-100 break-words leading-relaxed select-text">
          {text}
        </p>
      </div>
    );
  };

  // Create Chat Group Handler
  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    if (isSandboxMode) {
      const newGroup: Group = {
        id: `mock-group-${Date.now()}`,
        name: groupName.trim(),
        avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${groupName}`,
        created_by: currentUserId,
        created_at: new Date().toISOString(),
        members_count: selectedMembers.length + 1
      };
      setGroups(prev => [...prev, newGroup]);
      setActiveChat({ type: 'group', id: newGroup.id });
      setShowNewGroupModal(false);
      setGroupName('');
      setSelectedMembers([]);
    } else {
      try {
        setDbStatus('checking');
        // 1. Insert new group row
        const { data: gData, error: gError } = await supabase
          .from('groups')
          .insert({
            name: groupName.trim(),
            avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${groupName}`,
            created_by: currentUserId
          })
          .select()
          .single();

        if (gError) throw gError;

        // 2. Insert creator and selected members into group_members
        const memberPayloads = [
          { group_id: gData.id, user_id: currentUserId, role: 'admin' },
          ...selectedMembers.map(uid => ({ group_id: gData.id, user_id: uid, role: 'member' }))
        ];

        const { error: mError } = await supabase
          .from('group_members')
          .insert(memberPayloads);

        if (mError) throw mError;

        setShowNewGroupModal(false);
        setGroupName('');
        setSelectedMembers([]);
        fetchRealProfilesAndGroups();
        setActiveChat({ type: 'group', id: gData.id });
      } catch (err: any) {
        console.error('Failed to create group:', err);
        alert('Could not provision group. Please ensure tables exist and SQL trigger has run.');
      } finally {
        setDbStatus('connected');
      }
    }
  };

  const handleStartDirectChat = (partner: Profile) => {
    // If not in the profiles state, we can add it temporarily
    if (!profiles.some(u => u.id === partner.id)) {
      setProfiles(prev => [...prev, partner]);
    }
    setActiveChat({ type: 'direct', id: partner.id });
    setShowNewDirectChatModal(false);
  };

  const selectedChatDetails = () => {
    if (!activeChat) return null;
    if (activeChat.type === 'direct') {
      return profiles.find(p => p.id === activeChat.id) || {
        username: 'Recipent User',
        avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${activeChat.id}`,
        public_key: null
      };
    } else {
      return groups.find(g => g.id === activeChat.id) || {
        name: 'Secure Chat Group',
        avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${activeChat.id}`
      };
    }
  };

  const targetInfo = selectedChatDetails();

  // Retrieve list of users currently typing in the active chat room
  const activeTypingNames = Object.entries(typingUsers)
    .filter(([userId]) => {
      if (!activeChat) return false;
      if (activeChat.type === 'direct') {
        return userId === activeChat.id;
      } else {
        return true; // Show all typing users in group chats
      }
    })
    .map(([_, info]) => (info as { username: string; lastActive: number }).username);

  return (
    <div className="flex h-[100dvh] w-full bg-[#0b141a] overflow-hidden text-gray-200 font-sans">
      
      {/* Sidebar - Left Section */}
      <div className={`w-full md:w-[380px] bg-[#111b21] flex-col border-r border-[#222e35] shrink-0 ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Sidebar Header */}
        <div className="h-[64px] bg-[#202c33] px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={currentUserAvatar} 
              alt="My Avatar" 
              className="w-10 h-10 rounded-full border border-gray-700/50 bg-[#1f2c34]"
            />
            <div className="text-left -space-y-0.5">
              <div id="username-display" className="text-sm font-semibold text-white truncate max-w-[140px]">{currentUsername}</div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                {isSandboxMode ? (
                  <>
                    <Sparkles className="w-2.5 h-2.5" /> Demo Sandbox
                  </>
                ) : (
                  <>
                    <Globe className="w-2.5 h-2.5" /> Real Supabase
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="show-keys-btn"
              onClick={() => setShowKeyManager(!showKeyManager)}
              title="Secure E2EE Keys Manager"
              className={`p-2 rounded-full cursor-pointer hover:bg-gray-700/60 transition-colors relative ${
                showKeyManager || !hasE2EEKeys ? 'text-amber-400 bg-amber-400/5' : 'text-emerald-400 hover:text-emerald-300'
              }`}
            >
              <Key className="w-4 h-4" />
              {!hasE2EEKeys && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              )}
            </button>

            <button
              id="open-db-config-sidebar-btn"
              onClick={onOpenDbSetup}
              title="View SQL Schemas"
              className="p-2 text-gray-400 hover:text-white rounded-full cursor-pointer hover:bg-gray-700/60 transition-colors"
            >
              <Database className="w-4 h-4" />
            </button>

            {/* Calling History Trigger */}
            <button
              id="show-calls-history-btn"
              onClick={() => setShowCallHistory(!showCallHistory)}
              title="Call History"
              className={`p-2 rounded-full cursor-pointer hover:bg-gray-700/60 transition-colors ${
                showCallHistory ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-400 hover:text-white'
              }`}
            >
              <PhoneCall className="w-4 h-4" />
            </button>

            <button
              id="logout-btn"
              onClick={onLogout}
              title="Sign Out"
              className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-full cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sync Warn Alerts */}
        {dbStatus === 'error' && (
          <div className="m-3 p-3 bg-rose-500/15 border border-rose-500/20 rounded-xl space-y-2 text-left">
            <div className="flex gap-2 items-center text-rose-300 text-xs font-semibold">
              <AlertCircle className="w-4 h-4" /> Database Sync Blocked
            </div>
            <p className="text-[11px] text-rose-200/90 leading-relaxed">
              Required profiles / messages tables. Create them with the setup guide.
            </p>
            <button
              id="sidebar-troubleshoot-btn"
              onClick={onOpenDbSetup}
              className="w-full py-1 px-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded text-[10px] font-bold transition-all cursor-pointer"
            >
              Open SQL Console Guide
            </button>
          </div>
        )}

        {/* Collapsible Encryption Panel */}
        {showKeyManager && (
          <div className="p-3 border-b border-[#222e35] bg-[#0b141a]">
            <E2EEKeyManager 
              userId={currentUserId} 
              hasKeys={hasE2EEKeys} 
              onKeysGenerated={checkLocalKeypair}
              isSandboxMode={isSandboxMode}
              userEmail={currentUserEmail}
              username={currentUsername}
              avatarUrl={currentUserAvatar}
            />
          </div>
        )}

        {showCallHistory ? (
          <div className="flex-1 min-h-0">
            <CallHistoryScreen
              logs={callHistory}
              currentUserId={currentUserId}
              onClose={() => setShowCallHistory(false)}
              onStartCall={startCall}
            />
          </div>
        ) : (
          <>
            {/* Searching Contacts */}
            <div className="p-3">
              <div className="relative bg-[#202c33] flex items-center rounded-xl px-3 py-1.5 border border-gray-800 focus-within:border-emerald-500/40 select-none">
                <Search className="w-4 h-4 text-gray-400 mr-2" />
                <input 
                  type="text" 
                  placeholder="Search or start new chat" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-xs text-white focus:outline-none placeholder-gray-400"
                />
              </div>
            </div>

            {/* Dynamic Chats List */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-800/40">
              
              {/* Section: Direct Actions */}
              <div className="p-2 space-y-2 bg-[#1f2c34]/20">
                <div className="flex gap-2">
                  <button
                    id="modal-new-dm-btn"
                    onClick={() => setShowNewDirectChatModal(true)}
                    className="flex-1 py-2 px-3 bg-[#02e7f5]/10 hover:bg-[#02e7f5]/15 text-[#02e7f5] border border-[#02e7f5]/20 text-xs rounded-lg font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Private Chat
                  </button>
                  
                  <button
                    id="modal-new-group-btn"
                    onClick={() => setShowNewGroupModal(true)}
                    className="flex-1 py-2 px-3 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-xs rounded-lg font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" /> Group Chat
                  </button>
                </div>
              </div>

              {/* Direct Threads */}
              <div className="px-2 py-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase px-2 tracking-wider">Direct Channels</span>
                <div className="space-y-1 mt-2">
                  {profiles
                    .filter(p => !searchQuery || p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(profile => {
                      const isActive = activeChat?.type === 'direct' && activeChat.id === profile.id;
                      const targetHasKeys = !!profile.public_key;

                      return (
                        <button
                          key={profile.id}
                          onClick={() => setActiveChat({ type: 'direct', id: profile.id })}
                          className={`w-full p-2.5 rounded-xl text-left transition-all flex items-center gap-3 cursor-pointer ${
                            isActive ? 'bg-[#2a3942] text-white shadow-md' : 'hover:bg-[#202c33]/60 text-gray-300'
                          }`}
                        >
                          <div className="relative">
                            <img 
                              src={profile.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${profile.username}`} 
                              alt={profile.username} 
                              className="w-10 h-10 rounded-full bg-slate-800"
                            />
                            <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#111b21] ${
                              targetHasKeys ? 'bg-emerald-400' : 'bg-gray-500'
                            }`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-semibold truncate text-[#f0f2f5]">{profile.username}</h5>
                              {targetHasKeys ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" title="E2EE Active" />
                              ) : (
                                <Shield className="w-3.5 h-3.5 text-amber-500/60 shrink-0" title="Encryption keys not set" />
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <p className="text-[10px] text-gray-400 truncate font-mono">
                                {targetHasKeys ? 'RSA-2048 Channel Active' : 'No public catalog yet'}
                              </p>
                              {unreadCounts[profile.id] > 0 && (
                                <span className="bg-emerald-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 animate-pulse select-none min-w-[16px] text-center">
                                  {unreadCounts[profile.id]}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  
                  {profiles.length === 0 && (
                    <p className="text-[11px] text-gray-500 text-center py-4 italic select-none">No active direct contacts list.</p>
                  )}
                </div>
              </div>

              {/* Group Threads */}
              <div className="px-2 py-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase px-2 tracking-wider">Group Channels</span>
                <div className="space-y-1 mt-2">
                  {groups
                    .filter(g => !searchQuery || g.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(group => {
                      const isActive = activeChat?.type === 'group' && activeChat.id === group.id;

                      return (
                        <button
                          key={group.id}
                          onClick={() => setActiveChat({ type: 'group', id: group.id })}
                          className={`w-full p-2.5 rounded-xl text-left transition-all flex items-center gap-3 cursor-pointer ${
                            isActive ? 'bg-[#2a3942] text-white shadow-md' : 'hover:bg-[#202c33]/60 text-gray-300'
                          }`}
                        >
                          <img 
                            src={group.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${group.name}`} 
                            alt={group.name} 
                            className="w-10 h-10 rounded-full bg-slate-800"
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-semibold truncate text-[#f0f2f5]">{group.name}</h5>
                              <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <p className="text-[10px] text-gray-400 truncate font-mono">
                                Group Chat Room
                              </p>
                              {unreadCounts[group.id] > 0 && (
                                <span className="bg-emerald-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 animate-pulse select-none min-w-[16px] text-center">
                                  {unreadCounts[group.id]}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                  {groups.length === 0 && (
                    <p className="text-[11px] text-gray-500 text-center py-4 italic select-none">No group conversations found.</p>
                  )}
                </div>
              </div>

            </div>
          </>
        )}

      </div>

      {/* Main Canvas - Message Log / Setup Screens */}
      {activeChat && targetInfo ? (
        <div className="flex-1 bg-[#0b141a] flex flex-col relative h-full min-h-0 overflow-hidden">
          {/* Wallpaper background pattern */}
          <div className="absolute inset-0 bg-whatsapp-doodle opacity-[0.06] pointer-events-none" />

          {/* Chat Header */}
          <div className="h-[64px] bg-[#202c33] border-b border-gray-800/60 px-4 md:px-6 flex items-center justify-between shrink-0 relative z-10 select-none">
            <div className="flex items-center gap-2 md:gap-4">
              {/* Mobile Back Button */}
              <button 
                onClick={() => setActiveChat(null)}
                className="md:hidden p-2 text-gray-400 hover:text-white hover:bg-[#2a3942]/60 rounded-full transition-colors cursor-pointer mr-0.5 flex items-center justify-center shrink-0"
                aria-label="Back to conversations list"
              >
                <ArrowLeft className="w-5 h-5 text-emerald-400" />
              </button>

              <img 
                src={(targetInfo as any).avatar_url} 
                alt="Selected Chat Avatar" 
                className="w-10 h-10 rounded-full bg-slate-800 border border-gray-700/50"
              />
              <div className="text-left leading-tight">
                <h4 className="text-sm font-semibold text-white truncate max-w-[150px] sm:max-w-[200px] md:max-w-[400px]">
                  {(targetInfo as any).username || (targetInfo as any).name}
                </h4>
                {activeTypingNames.length > 0 ? (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1.5 mt-0.5 font-medium animate-pulse">
                    <span className="flex gap-0.5 items-center">
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    <span className="truncate max-w-[120px] sm:max-w-[200px]">
                      {activeTypingNames.join(', ')} {activeTypingNames.length === 1 ? 'is' : 'are'} typing...
                    </span>
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-400/85 flex items-center gap-1 mt-0.5 font-mono">
                    <Lock className="w-2.5 h-2.5" /> End-to-End Encrypted
                  </p>
                )}
              </div>
            </div>

            {/* Call Actions */}
            {activeChat && activeChat.type === 'direct' && (
              <div className="flex items-center gap-2">
                <CallButton
                  contact={{
                    id: activeChat.id,
                    username: (targetInfo as any).username || 'Contact'
                  }}
                  onStartCall={(contact, type) => startCall(contact, type)}
                  disabled={!!activeCall}
                />
                <VideoCallButton
                  contact={{
                    id: activeChat.id,
                    username: (targetInfo as any).username || 'Contact'
                  }}
                  onStartCall={(contact, type) => startCall(contact, type)}
                  disabled={!!activeCall}
                />
              </div>
            )}

            {activeChat && activeChat.type === 'group' && (
              <div className="flex items-center gap-2">
                {activeGroupRoomForCurrentChat ? (
                  <button
                    id="join-group-call-banner-btn"
                    onClick={() => joinGroupCall(activeGroupRoomForCurrentChat)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold px-4 py-2 rounded-full animate-pulse transition-all shadow-md shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Users className="w-3.5 h-3.5" /> Join Call
                  </button>
                ) : (
                  <GroupCallButtons
                    groupId={activeChat.id}
                    onStartGroupCall={(gId, type) => startGroupCall(gId, type)}
                    disabled={!!activeCall || !!activeGroupRoom}
                  />
                )}
              </div>
            )}
          </div>

          {/* Encryption Warning Bar */}
          <div className="bg-[#182229] border-b border-emerald-500/10 px-6 py-2 flex items-center justify-between text-[11px] text-gray-400 shrink-0 relative z-10 leading-normal">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <b>Client-to-Client Cryptography:</b> Messages are encoded on your browser and decoded locally. The database only sees ciphertext bytes.
              </span>
            </div>
          </div>

          {/* Log Message Board */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 relative z-10 min-h-0 bg-[#0b141a]">
            
            {/* Encryption Welcome Bubble */}
            <div className="max-w-md mx-auto text-center sticky top-2 z-10">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#182229] border border-gray-800 rounded-full text-[10px] text-amber-300 font-mono shadow-md backdrop-blur">
                <Lock className="w-3 h-3 text-emerald-400" /> WhatsApp E2EE Secure Room Connection Active
              </div>
            </div>

            {messages.map((msg, index) => {
              const isMe = msg.sender_id === currentUserId;
              const senderName = isMe ? 'You' : (profiles.find(p => p.id === msg.sender_id)?.username || msg.sender?.username || 'Secured Client');

              const prevMsg = index > 0 ? messages[index - 1] : null;
              const currentDateStr = getFriendlyDateHeader(msg.created_at);
              const prevDateStr = prevMsg ? getFriendlyDateHeader(prevMsg.created_at) : null;
              const showDateHeader = currentDateStr !== prevDateStr;

              return (
                <div key={msg.id} className="flex flex-col gap-4">
                  {showDateHeader && (
                    <div className="flex justify-center my-2 select-none animate-fade-in sticky top-2 z-20">
                      <span className="bg-[#182229]/90 backdrop-blur-sm border border-emerald-500/20 text-[#00a884] text-[10px] sm:text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-md">
                        {currentDateStr}
                      </span>
                    </div>
                  )}

                  <div 
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}
                  >
                    <div className={`max-w-[75%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-md flex flex-col relative group ${
                      isMe 
                        ? 'bg-[#005c4b] text-white rounded-tr-none' 
                        : 'bg-[#202c33] text-gray-200 rounded-tl-none'
                    }`}>
                      {/* Speaker name */}
                      {!isMe && (
                        <span className="text-[10px] font-bold text-emerald-400/90 tracking-wide mb-1 block">
                          {senderName}
                        </span>
                      )}

                      {/* Chat Text (with E2E decrypt support) */}
                      <DecryptedBubble msg={msg} />

                      {/* Timestamp & checkmarks */}
                      <div className="flex items-center justify-end gap-1.5 mt-1 font-mono text-[9px] text-gray-400 select-none">
                        <span 
                          title={new Date(msg.created_at).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}
                          className="cursor-help hover:text-gray-200 transition-colors"
                        >
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                        {isMe && (
                          <>
                            {(!msg.status || msg.status === 'sent') ? (
                              <Check className="w-3.5 h-3.5 text-gray-500 animate-pulse" title="Sent ✓" />
                            ) : msg.status === 'delivered' ? (
                              <CheckCheck className="w-3.5 h-3.5 text-gray-400" title="Delivered ✓✓" />
                            ) : msg.status === 'read' ? (
                              <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" title="Seen/Read ✓✓" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-gray-500" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {messages.length === 0 && (
              <div className="h-[250px] flex flex-col items-center justify-center text-center space-y-2 select-none">
                <Lock className="w-10 h-10 text-emerald-400/20" />
                <p className="text-gray-500 text-xs font-semibold">No secured messages yet</p>
                <p className="text-gray-600 text-[10px] max-w-xs leading-normal">
                  Send a hybrid-encrypted message to start the private peer conversational log.
                </p>
              </div>
            )}

            <div ref={messageEndRef} />
          </div>

          {/* Send Input Bar */}
          <form 
            onSubmit={handleSendMessage}
            className="h-[64px] bg-[#202c33] border-t border-gray-800/60 px-6 flex items-center gap-4 shrink-0 relative z-10"
          >
            <div className="flex-1 relative">
              <input 
                type="text" 
                placeholder="Type your secure E2E message here..." 
                value={inputMessage}
                onChange={(e) => handleInputChange(e.target.value)}
                className="w-full bg-[#2a3942] text-sm text-white placeholder-gray-400 border border-gray-800 pl-4 pr-10 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400/65" title="Writing unhackable keystream" />
              </span>
            </div>

            <button 
              type="submit"
              className="p-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-slate-950 font-bold shadow-lg transition-transform active:scale-[0.95] shrink-0 cursor-pointer flex justify-center items-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>
      ) : (
        /* Empty Lobby Splash View */
        <div className="hidden md:flex flex-1 bg-[#222e35]/15 flex-col items-center justify-center p-8 select-none relative">
          <div className="absolute inset-0 bg-whatsapp-doodle opacity-[0.03] pointer-events-none" />
          
          <div className="max-w-md text-center space-y-4 relative z-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#00a884]/15 rounded-2xl text-[#00a884] mb-2 animate-pulse">
              <ShieldCheck className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white tracking-tight">WhatsApp Encrypted Workspace</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Activate real-time chats with client-side keys. Choose or trigger an active direct chat room from the sidebar left-side panel to begin the E2EE transcripts log.
            </p>

            <div className="pt-4 grid grid-cols-2 gap-3 text-left">
              <div className="bg-[#111b21] p-3 rounded-lg border border-gray-800">
                <span className="text-[10px] font-bold text-emerald-400 uppercase">1. SECURE KEYS</span>
                <p className="text-[10px] text-gray-400 leading-normal mt-1">
                  Cryptographic RSA-2048 parameters are generated right inside your browser frame. No snooping.
                </p>
              </div>
              <div className="bg-[#111b21] p-3 rounded-lg border border-gray-800">
                <span className="text-[10px] font-bold text-emerald-400 uppercase">2. DB PERFORMANCE</span>
                <p className="text-[10px] text-gray-400 leading-normal mt-1">
                  Foreign keys and triggering functions are built robustly for real-time Postgres channels.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* E2EE Payload Details Analyzer Tooltip / Modal */}
      {e2eeExplainer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div id="e2ee-payload-modal" className="bg-[#1f2c34] text-gray-200 rounded-2xl w-full max-w-xl p-6 border border-emerald-500/15 shadow-2xl relative select-none">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h4 className="font-semibold text-white text-base">E2EE Database Scrambler Analyzer</h4>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed mb-4">
              This panel shows the exact contrast between the **Real Scrambled Ciphertext** stored inside the public database table and the decrypted text rendered client-side on your monitor.
            </p>

            <div className="space-y-4 font-mono text-[10px]">
              <div className="space-y-1">
                <span className="text-gray-400 block font-sans font-semibold text-xs">🔒 Database Row State (What hackers & database admins see):</span>
                <div className="bg-[#0b141a] p-3 rounded-xl border border-gray-800 select-all max-h-[140px] overflow-y-auto break-all">
                  <div className="text-rose-400 mb-1">{"{"}</div>
                  <div className="pl-4 text-gray-300">"message_id": "{e2eeExplainer.id}",</div>
                  <div className="pl-4 text-emerald-400">"encrypted_body": "{e2eeExplainer.encrypted_body || 'ENC_BODY_BASE64'}",</div>
                  <div className="pl-4 text-amber-400">"receiver_encrypted_key": "{e2eeExplainer.receiver_encrypted_key?.substring(0, 48) || 'MOCK_RSA_OAEP_AES_SESSION_KEY_CIPHERTEXT'}...",</div>
                  <div className="pl-4 text-gray-400">"is_encrypted": true,</div>
                  <div className="pl-4 text-gray-400">"sender_id": "{e2eeExplainer.sender_id}"</div>
                  <div className="text-rose-400">{"}"}</div>
                </div>
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/15 rounded-xl font-sans text-emerald-300 text-xs leading-normal">
                🤖 <b>Verdict: Safe!</b> The server cannot decrypt the <code>encrypted_body</code> because the key needed to decode it is wrapped inside the RSA key <code>receiver_encrypted_key</code>. Only the recipient's unique browser private key can release that key!
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                id="close-explainer-btn"
                onClick={() => setE2eeExplainer(null)}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-[#0b141a] font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Close Analyzer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Group Modal */}
      {showNewGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreateGroup}
            id="new-group-form"
            className="bg-[#1f2c34] text-gray-200 rounded-2xl w-full max-w-md p-6 border border-gray-700/60 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" /> Create Security Group
              </h4>
              <button 
                type="button" 
                onClick={() => setShowNewGroupModal(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">Group Room Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Secret Security Discussions"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full bg-[#2a3942] border border-gray-700 rounded-xl px-4 py-2.5 text-sm font-sans focus:outline-none focus:border-emerald-500/50 text-white"
              />
            </div>

            {/* Profiles Multi-Select */}
            <div className="space-y-1">
              <label className="text-xs text-gray-400">Select Group Contacts</label>
              <div className="max-h-[160px] overflow-y-auto border border-gray-700/60 rounded-xl p-2 bg-[#121b22] space-y-1.5 scrollbar-thin">
                {profiles.map(p => {
                  const isSelected = selectedMembers.includes(p.id);
                  return (
                    <label 
                      key={p.id}
                      className="flex items-center justify-between p-1.5 hover:bg-gray-800/40 rounded-lg cursor-pointer text-xs select-none"
                    >
                      <div className="flex items-center gap-2">
                        <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full bg-slate-800" />
                        <span>{p.username}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMembers(prev => [...prev, p.id]);
                          } else {
                            setSelectedMembers(prev => prev.filter(id => id !== p.id));
                          }
                        }}
                        className="accent-emerald-500 h-4.5 w-4.5"
                      />
                    </label>
                  );
                })}

                {profiles.length === 0 && (
                  <p className="text-[11px] text-gray-500 text-center py-4 italic">No other registered contacts to select.</p>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              Initialize Encrypted Group
            </button>
          </form>
        </div>
      )}

      {/* New Direct Chat Modal */}
      {showNewDirectChatModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            id="new-direct-chat-modal"
            className="bg-[#1f2c34] text-gray-200 rounded-2xl w-full max-w-sm p-6 border border-gray-700/60 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" /> Create Security Direct Chat
              </h4>
              <button 
                type="button" 
                onClick={() => setShowNewDirectChatModal(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {isSandboxMode ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 leading-normal">
                  In Demo Sandbox, we pre-configured Bob and Charlie to represent active cryptographic channels. Select one:
                </p>
                <div className="space-y-1.5 pt-1">
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleStartDirectChat(p)}
                      className="w-full p-2 bg-[#2a3942] hover:bg-gray-700/40 border border-gray-700 rounded-xl text-xs text-left flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full bg-slate-800" />
                      <div className="flex-1">
                        <div className="font-semibold text-white">{p.username}</div>
                        <div className="text-[10px] text-emerald-400 font-mono">E2EE Key Registered</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 leading-normal">
                  Select a contact below from the registered user profile list to start a private cryptographic connection:
                </p>
                <div className="max-h-[220px] overflow-y-auto space-y-1.5 scrollbar-thin">
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleStartDirectChat(p)}
                      className="w-full p-2.5 bg-gray-850 hover:bg-gray-800/40 border border-gray-700/50 rounded-xl text-left flex items-center gap-3 transition-colors cursor-pointer"
                    >
                      <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full bg-slate-800" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{p.username}</div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">
                          {p.public_key ? '🔐 RSA-OAEP ready' : '❌ Key not generated yet'}
                        </div>
                      </div>
                    </button>
                  ))}

                  {dbErrorString && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] rounded-lg leading-relaxed text-left space-y-1">
                      <p className="font-semibold">⚠️ Schema check warning:</p>
                      <p className="font-mono text-[9px] truncate bg-black/30 p-1 rounded">{dbErrorString}</p>
                      <p className="text-gray-400 mt-1">
                        If the <b>profiles</b> table is missing columns, please re-run the updated SQL setup script to add them.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewDirectChatModal(false);
                          onOpenDbSetup();
                        }}
                        className="text-emerald-400 font-bold hover:underline block mt-1 cursor-pointer"
                      >
                        👉 Open SQL Editor Script
                      </button>
                    </div>
                  )}

                  {profiles.length === 0 && !dbErrorString && (
                    <div className="text-center py-4 space-y-3">
                      <p className="text-[11px] text-gray-400 leading-relaxed text-left bg-black/20 p-2.5 rounded-lg">
                        💡 <b>Why are no users appearing?</b> Если таблицы были созданы <i>после</i> регистрации аккаунтов, Ваши pre-existing пользователи не были скопированы автоматически.
                        <br /><br />
                        Please open the database console, copy the latest script, and run it in the Supabase SQL Editor. It includes a <b>BACKFILL</b> section at the end to map existing accounts into chat contacts immediately!
                      </p>
                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          type="button"
                          id="refresh-profiles-btn"
                          onClick={fetchRealProfilesAndGroups}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#202c33] hover:bg-gray-800/50 border border-gray-700 text-[11px] font-semibold text-[#00a884] hover:text-[#00cfa2] rounded-lg transition-colors cursor-pointer mx-auto"
                        >
                          🔄 Fetch & Sync Database Contacts
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewDirectChatModal(false);
                            onOpenDbSetup();
                          }}
                          className="text-[11px] font-semibold text-emerald-400 hover:underline cursor-pointer"
                        >
                          Show SQL Script for Backfill & Sync
                        </button>
                      </div>
                    </div>
                  )}

                  {profiles.length === 0 && dbErrorString && (
                    <div className="text-center py-2">
                      <button
                        type="button"
                        id="refresh-profiles-btn-err"
                        onClick={fetchRealProfilesAndGroups}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#202c33] hover:bg-gray-800/50 border border-gray-700 text-[11px] font-semibold text-[#00a884] hover:text-[#00cfa2] rounded-lg transition-colors cursor-pointer mx-auto animate-pulse"
                      >
                        🔄 Retry Database Sync
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-App Toast Popup Notification Overlay */}
      {popupNotification && (
        <div 
          onClick={handleNotificationClick} 
          className="fixed top-4 right-4 z-50 bg-[#1f2c34] text-gray-200 p-4 rounded-2xl shadow-2xl border border-emerald-500/30 flex items-center gap-3.5 max-w-sm w-96 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer hover:border-emerald-500"
        >
          <img 
            src={popupNotification.senderAvatar} 
            alt={popupNotification.senderName} 
            className="w-11 h-11 rounded-full bg-slate-800 border-2 border-emerald-500/20 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white truncate pr-1">
                {popupNotification.senderName}
              </span>
              <span className="text-[8px] text-emerald-400 font-mono tracking-wider shrink-0 bg-emerald-500/10 px-1 py-0.5 rounded uppercase">
                New Message
              </span>
            </div>
            <p className="text-[11px] text-gray-300 truncate mt-0.5 leading-normal">
              {popupNotification.previewText}
            </p>
            <p className="text-[8px] text-gray-400 font-sans mt-1 text-right">
              Click to view message
            </p>
          </div>
          <button 
            type="button" 
            onClick={(e) => {
              e.stopPropagation();
              setPopupNotification(null);
            }} 
            className="text-gray-400 hover:text-white p-1 hover:bg-[#2a3942] rounded-lg text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* --- CALLS OVERLAY SYSTEMS --- */}
      {/* Incoming Call Prompt */}
      {activeCall && callRole === 'receiver' && activeCall.status === 'ringing' && (
        <IncomingCallModal
          call={activeCall}
          caller={otherPartyProfile}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      {/* Outgoing Call Overlay */}
      {activeCall && callRole === 'caller' && activeCall.status === 'ringing' && (
        <OutgoingCallScreen
          call={activeCall}
          recipient={otherPartyProfile}
          onEndCall={endCall}
        />
      )}

      {/* Active Voice Call Screen */}
      {activeCall && activeCall.status === 'accepted' && activeCall.call_type === 'audio' && (
        <ActiveVoiceCallScreen
          call={activeCall}
          recipient={otherPartyProfile}
          remoteStream={remoteStream}
          isMuted={isMuted}
          isSpeakerMode={isSpeakerMode}
          callDuration={callDuration}
          onToggleMute={toggleMute}
          onToggleSpeaker={() => setIsSpeakerMode(!isSpeakerMode)}
          onEndCall={endCall}
        />
      )}

      {/* Active Video Call Screen */}
      {activeCall && activeCall.status === 'accepted' && activeCall.call_type === 'video' && (
        <ActiveVideoCallScreen
          call={activeCall}
          recipient={otherPartyProfile}
          localStream={localStream}
          remoteStream={remoteStream}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          callDuration={callDuration}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onSwitchCamera={switchCamera}
          onEndCall={endCall}
        />
      )}

      {/* --- GROUP CALLS OVERLAY SYSTEMS --- */}
      {/* Incoming Group Call Prompt */}
      {incomingGroupRoom && incomingGroupName && incomingCallerName && (
        <IncomingGroupCallModal
          room={incomingGroupRoom}
          groupName={incomingGroupName}
          callerName={incomingCallerName}
          onAccept={(room) => joinGroupCall(room)}
          onReject={rejectIncomingGroupCall}
        />
      )}

      {/* Active Group Calling Overlay */}
      {activeGroupRoom && (
        <GroupCallScreen
          activeRoom={activeGroupRoom}
          participants={groupParticipants}
          localStream={groupLocalStream}
          remoteStreams={groupRemoteStreams}
          callDuration={groupCallDuration}
          isMinimized={isGroupCallMinimized}
          isMuted={isGroupMuted}
          isCameraEnabled={isGroupCameraEnabled}
          facingMode={groupFacingMode}
          onLeaveCall={leaveGroupCall}
          onEndCall={endGroupCall}
          onToggleMute={toggleGroupLocalMute}
          onToggleCamera={toggleGroupLocalCamera}
          onSwitchCamera={switchGroupCamera}
          onMinimize={setIsGroupCallMinimized}
          currentUserId={currentUserId}
        />
      )}

      {/* Group Call Error Toast Alert */}
      {groupCallError && (
        <div className="fixed bottom-4 right-4 z-[99999] bg-red-600 border border-red-700/50 text-white rounded-lg px-4 py-3 shadow-2xl flex items-center gap-3 animate-bounce">
          <span className="text-lg">⚠️</span>
          <div className="text-xs font-semibold">{groupCallError}</div>
          <button onClick={() => setGroupCallError(null)} className="text-white hover:text-gray-200 ml-2">✕</button>
        </div>
      )}

      {/* Error Call Toast Alert if any */}
      {callError && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-600 border border-red-700/50 text-white rounded-lg px-4 py-3 shadow-2xl flex items-center gap-3 animate-bounce">
          <span className="text-lg">⚠️</span>
          <div className="text-xs font-semibold">{callError}</div>
          <button onClick={() => setCallError(null)} className="text-white hover:text-gray-200 ml-2">✕</button>
        </div>
      )}

    </div>
  );
}
