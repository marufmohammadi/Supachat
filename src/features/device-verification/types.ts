export interface UserDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_fingerprint: string;
  device_name: string;
  browser: string;
  browser_version: string;
  operating_system: string;
  platform: string;
  screen_resolution: string;
  timezone: string;
  language: string;
  public_key_fingerprint: string;
  login_time: string;
  last_active: string;
  login_count: number;
  is_primary?: boolean;
  is_revoked?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisterDevicePayload {
  device_id: string;
  device_fingerprint: string;
  device_name: string;
  browser: string;
  browser_version: string;
  operating_system: string;
  platform: string;
  screen_resolution: string;
  timezone: string;
  language: string;
  public_key_fingerprint: string;
}

export interface NewDeviceAlert {
  id: string;
  device_name: string;
  browser: string;
  operating_system: string;
  login_time: string;
  timestamp: number;
}

export interface DeviceLoginRequest {
  id: string;
  user_id: string;
  requester_device_id: string;
  requester_device_name: string;
  requester_browser: string;
  requester_os: string;
  requester_fingerprint: string;
  primary_device_id?: string;
  qr_session_token?: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface QRLinkSession {
  id: string;
  user_id: string;
  token: string;
  status: 'active' | 'used' | 'expired';
  created_at: string;
  expires_at: string;
}

