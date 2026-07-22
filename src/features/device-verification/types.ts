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
