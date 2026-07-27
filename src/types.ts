export interface Profile {
  id: string;
  username: string;
  avatar_url: string;
  public_key?: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  avatar_url: string;
  created_by: string;
  created_at: string;
  members_count?: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  profile?: Profile;
}

export type MessageMode = 'normal' | 'view_once' | 'auto_delete';

export interface Message {
  id: string;
  sender_id: string;
  receiver_id?: string | null;
  group_id?: string | null;
  encrypted_body: string;
  sender_encrypted_key?: string | null;
  receiver_encrypted_key?: string | null;
  is_encrypted: boolean;
  created_at: string;
  sender?: Profile;
  receiver?: Profile;
  status?: 'sent' | 'delivered' | 'read' | 'expired' | null;
  delivered_at?: string | null;
  read_at?: string | null;
  message_mode?: MessageMode;
  view_once?: boolean;
  expires_at?: string | null;
  opened_at?: string | null;
  opened_by?: string[] | null;
  destroyed_at?: string | null;
}

export interface LocalKeyPair {
  publicKeyJWK: string;
  privateKey: CryptoKey;
}
