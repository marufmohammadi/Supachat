export type GroupCallType = 'audio' | 'video';
export type GroupCallRoomStatus = 'ringing' | 'active' | 'ended';

export interface CallRoom {
  id: string;
  group_id: string;
  call_type: GroupCallType;
  created_by: string;
  status: GroupCallRoomStatus;
  created_at: string;
}

export interface CallParticipant {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
  is_muted: boolean;
  camera_enabled: boolean;
  // Attached client-side for convenient rendering
  profile?: {
    username: string;
    avatar_url?: string;
  };
  stream?: MediaStream | null;
}

export interface GroupCallSignal {
  id: string;
  room_id: string;
  sender_id: string;
  receiver_id: string;
  type: 'offer' | 'answer' | 'candidate';
  data: any;
  created_at: string;
}
