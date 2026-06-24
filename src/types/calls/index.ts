export type CallType = 'audio' | 'video';

export type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'busy' | 'ended';

export interface Call {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: CallType;
  status: CallStatus;
  started_at?: string;
  ended_at?: string;
  duration?: number;
}

export interface CallSignal {
  id: string;
  call_id: string;
  sender_id: string;
  type: 'offer' | 'answer' | 'candidate' | 'hangup';
  data: any; // SDP or ICE candidate object
  created_at: string;
}

export interface CallLog {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: CallType;
  status: CallStatus;
  duration: number;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}
