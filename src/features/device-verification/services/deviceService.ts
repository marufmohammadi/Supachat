import { supabase } from '../../../lib/supabase';
import { RegisterDevicePayload, UserDevice, DeviceLoginRequest, QRLinkSession } from '../types';

const SANDBOX_DEVICES_KEY = 'whatsapp_sandbox_user_devices';
const SANDBOX_REQUESTS_KEY = 'whatsapp_sandbox_login_requests';
const SANDBOX_QR_KEY = 'whatsapp_sandbox_qr_sessions';

function getSandboxDevices(userId: string): UserDevice[] {
  try {
    const raw = localStorage.getItem(`${SANDBOX_DEVICES_KEY}_${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSandboxDevices(userId: string, devices: UserDevice[]) {
  try {
    localStorage.setItem(`${SANDBOX_DEVICES_KEY}_${userId}`, JSON.stringify(devices));
  } catch {
    // ignore
  }
}

function getSandboxRequests(userId: string): DeviceLoginRequest[] {
  try {
    const raw = localStorage.getItem(`${SANDBOX_REQUESTS_KEY}_${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveSandboxRequests(userId: string, reqs: DeviceLoginRequest[]) {
  try {
    localStorage.setItem(`${SANDBOX_REQUESTS_KEY}_${userId}`, JSON.stringify(reqs));
  } catch {
    // ignore
  }
}

const HEARTBEAT_TIMEOUT_MS = 120000; // 2 minutes heartbeat window for active sessions

export const deviceService = {
  async getActivePrimaryDevice(userId: string, isSandboxMode: boolean): Promise<UserDevice | null> {
    if (!userId) return null;

    if (isSandboxMode) {
      const devices = getSandboxDevices(userId).filter(d => !d.is_revoked && d.is_primary);
      return devices[0] || null;
    }

    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('*')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .eq('is_revoked', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data as UserDevice;
    } catch {
      return null;
    }
  },

  async getPrimaryDevice(userId: string, isSandboxMode: boolean): Promise<UserDevice | null> {
    return this.getActivePrimaryDevice(userId, isSandboxMode);
  },

  async updateHeartbeat(userId: string, deviceId: string, isSandboxMode: boolean): Promise<void> {
    if (!userId || !deviceId) return;
    const nowIso = new Date().toISOString();

    if (isSandboxMode) {
      const devices = getSandboxDevices(userId);
      const idx = devices.findIndex(d => d.device_id === deviceId || d.id === deviceId);
      if (idx >= 0) {
        devices[idx].last_active = nowIso;
        saveSandboxDevices(userId, devices);
      }
      return;
    }

    try {
      await supabase
        .from('user_devices')
        .update({ last_active: nowIso, updated_at: nowIso })
        .eq('user_id', userId)
        .eq('device_id', deviceId);
    } catch (err) {
      console.warn('[DEVICE-VERIFICATION] Heartbeat update warning:', err);
    }
  },

  async promoteToPrimaryDevice(userId: string, deviceId: string, isSandboxMode: boolean): Promise<void> {
    if (!userId || !deviceId) return;
    const nowIso = new Date().toISOString();

    if (isSandboxMode) {
      const devices = getSandboxDevices(userId);
      devices.forEach(d => {
        if (d.device_id === deviceId || d.id === deviceId) {
          d.is_primary = true;
          d.is_revoked = false;
          d.last_active = nowIso;
        } else {
          d.is_primary = false;
        }
      });
      saveSandboxDevices(userId, devices);
      return;
    }

    try {
      // Step 1: Optimistic demote of any existing primary devices for this user
      await supabase
        .from('user_devices')
        .update({ is_primary: false, updated_at: nowIso })
        .eq('user_id', userId)
        .eq('is_primary', true);

      // Step 2: Set target device as Primary Device
      await supabase
        .from('user_devices')
        .update({ is_primary: true, is_revoked: false, last_active: nowIso, updated_at: nowIso })
        .eq('user_id', userId)
        .eq('device_id', deviceId);
    } catch (err) {
      console.warn('[DEVICE-VERIFICATION] promoteToPrimaryDevice warning:', err);
    }
  },

  async handleLogoutCleanup(userId: string, deviceId?: string, isSandboxMode?: boolean): Promise<void> {
    if (!userId) return;
    const oldTimeIso = '1970-01-01T00:00:00.000Z';

    if (isSandboxMode) {
      if (deviceId) {
        const devices = getSandboxDevices(userId);
        devices.forEach(d => {
          if (d.device_id === deviceId || d.id === deviceId) {
            d.is_primary = false;
            d.is_revoked = true;
            d.last_active = oldTimeIso;
          }
        });
        saveSandboxDevices(userId, devices);
      } else {
        saveSandboxDevices(userId, []);
      }
      saveSandboxRequests(userId, []);
      localStorage.removeItem(`${SANDBOX_QR_KEY}_${userId}`);
      return;
    }

    try {
      // 1. Mark device as non-primary, revoked, and clear heartbeat
      if (deviceId) {
        await supabase
          .from('user_devices')
          .update({
            is_primary: false,
            is_revoked: true,
            last_active: oldTimeIso,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('device_id', deviceId);
      } else {
        await supabase
          .from('user_devices')
          .update({
            is_primary: false,
            is_revoked: true,
            last_active: oldTimeIso,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
      }

      // 2. Revoke/expire pending login approval requests
      await supabase
        .from('device_login_requests')
        .update({ status: 'expired' })
        .eq('user_id', userId)
        .eq('status', 'pending');

      // 3. Remove/consume active QR sessions
      await supabase
        .from('qr_link_sessions')
        .update({ status: 'consumed' })
        .eq('user_id', userId)
        .eq('status', 'active');
    } catch (err) {
      console.warn('[DEVICE-VERIFICATION] handleLogoutCleanup warning:', err);
    }
  },

  async registerDevice(
    userId: string,
    payload: RegisterDevicePayload,
    isSandboxMode: boolean,
    forceLinkedDevice: boolean = false
  ): Promise<{ device: UserDevice; isNewDevice: boolean }> {
    const nowIso = new Date().toISOString();

    if (isSandboxMode) {
      const existingDevices = getSandboxDevices(userId);
      const existingIndex = existingDevices.findIndex(
        d => d.device_id === payload.device_id
      );

      const hasPrimary = existingDevices.some(d => d.is_primary && !d.is_revoked);
      const isPrimary = !forceLinkedDevice && !hasPrimary;

      if (existingIndex >= 0) {
        const existing = existingDevices[existingIndex];
        const updated: UserDevice = {
          ...existing,
          device_id: payload.device_id,
          last_active: nowIso,
          login_time: nowIso,
          login_count: (existing.login_count || 1) + 1,
          public_key_fingerprint: payload.public_key_fingerprint,
          is_revoked: false,
          is_primary: existing.is_primary ?? isPrimary,
          updated_at: nowIso
        };
        existingDevices[existingIndex] = updated;
        saveSandboxDevices(userId, existingDevices);
        return { device: updated, isNewDevice: false };
      } else {
        const newDevice: UserDevice = {
          id: 'dev-sand-' + Math.random().toString(36).substring(2, 9),
          user_id: userId,
          device_id: payload.device_id,
          device_fingerprint: payload.device_fingerprint,
          device_name: payload.device_name,
          browser: payload.browser,
          browser_version: payload.browser_version,
          operating_system: payload.operating_system,
          platform: payload.platform,
          screen_resolution: payload.screen_resolution,
          timezone: payload.timezone,
          language: payload.language,
          public_key_fingerprint: payload.public_key_fingerprint,
          login_time: nowIso,
          last_active: nowIso,
          login_count: 1,
          is_primary: isPrimary,
          is_revoked: false,
          created_at: nowIso,
          updated_at: nowIso
        };
        existingDevices.push(newDevice);
        saveSandboxDevices(userId, existingDevices);
        return { device: newDevice, isNewDevice: true };
      }
    }

    try {
      // 1. Check existing devices count to determine if primary
      const { data: allUserDevices } = await supabase
        .from('user_devices')
        .select('id, is_primary, is_revoked')
        .eq('user_id', userId)
        .eq('is_revoked', false);

      const hasPrimary = (allUserDevices || []).some(d => d.is_primary);
      const isPrimary = !forceLinkedDevice && !hasPrimary;

      // 2. Check if user device exists with this device_id
      const { data: existing, error: fetchError } = await supabase
        .from('user_devices')
        .select('*')
        .eq('user_id', userId)
        .eq('device_id', payload.device_id)
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('[DEVICE-VERIFICATION] Table check warning:', fetchError.message);
      }

      if (existing) {
        // Update
        const { data: updated, error: updateError } = await supabase
          .from('user_devices')
          .update({
            device_id: payload.device_id,
            last_active: nowIso,
            login_time: nowIso,
            login_count: (existing.login_count || 1) + 1,
            public_key_fingerprint: payload.public_key_fingerprint,
            is_revoked: false,
            updated_at: nowIso
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError || !updated) {
          console.warn('[DEVICE-VERIFICATION] Failed update, fallback to local object:', updateError?.message);
          return {
            device: {
              ...existing,
              last_active: nowIso,
              login_time: nowIso,
              is_revoked: false,
              login_count: (existing.login_count || 1) + 1,
              updated_at: nowIso
            },
            isNewDevice: false
          };
        }

        return { device: updated as UserDevice, isNewDevice: false };
      } else {
        // Insert
        const newRecord = {
          user_id: userId,
          device_id: payload.device_id,
          device_fingerprint: payload.device_fingerprint,
          device_name: payload.device_name,
          browser: payload.browser,
          browser_version: payload.browser_version,
          operating_system: payload.operating_system,
          platform: payload.platform,
          screen_resolution: payload.screen_resolution,
          timezone: payload.timezone,
          language: payload.language,
          public_key_fingerprint: payload.public_key_fingerprint,
          login_time: nowIso,
          last_active: nowIso,
          login_count: 1,
          is_primary: isPrimary,
          is_revoked: false
        };

        const { data: inserted, error: insertError } = await supabase
          .from('user_devices')
          .insert(newRecord)
          .select()
          .single();

        if (insertError || !inserted) {
          console.warn('[DEVICE-VERIFICATION] Insert error or schema missing:', insertError?.message);
          const localDevice: UserDevice = {
            id: 'dev-fallback-' + Math.random().toString(36).substring(2, 9),
            ...newRecord,
            created_at: nowIso,
            updated_at: nowIso
          };
          return { device: localDevice, isNewDevice: true };
        }

        return { device: inserted as UserDevice, isNewDevice: true };
      }
    } catch (err) {
      console.warn('[DEVICE-VERIFICATION] Safe registration catch:', err);
      const fallback: UserDevice = {
        id: 'dev-local-' + Math.random().toString(36).substring(2, 9),
        user_id: userId,
        device_id: payload.device_id,
        device_fingerprint: payload.device_fingerprint,
        device_name: payload.device_name,
        browser: payload.browser,
        browser_version: payload.browser_version,
        operating_system: payload.operating_system,
        platform: payload.platform,
        screen_resolution: payload.screen_resolution,
        timezone: payload.timezone,
        language: payload.language,
        public_key_fingerprint: payload.public_key_fingerprint,
        login_time: nowIso,
        last_active: nowIso,
        login_count: 1,
        is_primary: false,
        is_revoked: false,
        created_at: nowIso,
        updated_at: nowIso
      };
      return { device: fallback, isNewDevice: true };
    }
  },

  async getLinkedDevices(userId: string, isSandboxMode: boolean): Promise<UserDevice[]> {
    if (isSandboxMode) {
      return getSandboxDevices(userId).filter(d => !d.is_revoked);
    }

    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('*')
        .eq('user_id', userId)
        .eq('is_revoked', false)
        .order('last_active', { ascending: false });

      if (error) {
        console.warn('[DEVICE-VERIFICATION] getLinkedDevices error:', error.message);
        return [];
      }

      return (data || []) as UserDevice[];
    } catch (err) {
      console.warn('[DEVICE-VERIFICATION] getLinkedDevices catch:', err);
      return [];
    }
  },

  async isDeviceApproved(userId: string, deviceId: string, isSandboxMode: boolean): Promise<boolean> {
    if (!userId || !deviceId) return false;
    if (isSandboxMode) {
      const devices = getSandboxDevices(userId).filter(d => !d.is_revoked);
      return devices.some(d => d.device_id === deviceId || d.id === deviceId);
    }
    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('id, device_id, is_revoked')
        .eq('user_id', userId)
        .eq('is_revoked', false);

      if (error || !data) return false;
      return data.some(d => d.device_id === deviceId || d.id === deviceId);
    } catch {
      return false;
    }
  },

  async logoutDevice(userId: string, deviceTableId: string, isSandboxMode: boolean): Promise<boolean> {
    if (isSandboxMode) {
      const list = getSandboxDevices(userId).map(d => 
        d.id === deviceTableId ? { ...d, is_revoked: true } : d
      );
      saveSandboxDevices(userId, list);

      // Dispatch window event for instant local sandbox update
      window.dispatchEvent(new CustomEvent('sandbox_device_revoked', { detail: { deviceId: deviceTableId } }));
      return true;
    }

    try {
      // 1. Mark as revoked in user_devices
      const { error: updateError } = await supabase
        .from('user_devices')
        .update({ is_revoked: true, updated_at: new Date().toISOString() })
        .eq('id', deviceTableId)
        .eq('user_id', userId);

      if (updateError) {
        console.warn('[DEVICE-VERIFICATION] Update is_revoked warning:', updateError.message);
      }

      // 2. Broadcast instant force_logout event on realtime channel
      try {
        const securityChannel = supabase.channel(`device_security_${userId}`);
        await securityChannel.send({
          type: 'broadcast',
          event: 'force_logout',
          payload: { deviceId: deviceTableId }
        });
      } catch (broadcastErr) {
        console.warn('[DEVICE-VERIFICATION] Broadcast error:', broadcastErr);
      }

      // 3. Delete from table as well to trigger postgres_changes DELETE
      await supabase
        .from('user_devices')
        .delete()
        .eq('id', deviceTableId)
        .eq('user_id', userId);

      return true;
    } catch (err) {
      console.error('[DEVICE-VERIFICATION] Logout device catch:', err);
      return false;
    }
  },

  // LOGIN APPROVAL REQUEST SERVICES
  async createLoginRequest(
    userId: string,
    payload: RegisterDevicePayload,
    isSandboxMode: boolean,
    qrToken?: string
  ): Promise<DeviceLoginRequest> {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 1000).toISOString(); // 60s timeout
    const activePrimary = await this.getActivePrimaryDevice(userId, isSandboxMode);

    const reqData: Partial<DeviceLoginRequest> = {
      user_id: userId,
      requester_device_id: payload.device_id,
      requester_device_name: payload.device_name,
      requester_browser: payload.browser,
      requester_os: payload.operating_system,
      requester_fingerprint: payload.device_fingerprint,
      primary_device_id: activePrimary?.device_id || undefined,
      qr_session_token: qrToken || null,
      status: 'pending',
      created_at: now.toISOString(),
      expires_at: expires
    };

    if (isSandboxMode) {
      const reqs = getSandboxRequests(userId);
      const newReq: DeviceLoginRequest = {
        id: 'req-sand-' + Math.random().toString(36).substring(2, 9),
        ...(reqData as DeviceLoginRequest)
      };
      reqs.push(newReq);
      saveSandboxRequests(userId, reqs);
      window.dispatchEvent(new CustomEvent('sandbox_login_request_created', { detail: newReq }));
      return newReq;
    }

    try {
      const { data, error } = await supabase
        .from('device_login_requests')
        .insert(reqData)
        .select()
        .single();

      if (error || !data) {
        console.warn('[DEVICE-VERIFICATION] Fallback creating login request locally:', error?.message);
        return {
          id: 'req-local-' + Math.random().toString(36).substring(2, 9),
          ...(reqData as DeviceLoginRequest)
        };
      }

      return data as DeviceLoginRequest;
    } catch {
      return {
        id: 'req-local-' + Math.random().toString(36).substring(2, 9),
        ...(reqData as DeviceLoginRequest)
      };
    }
  },

  async getPendingLoginRequests(userId: string, isSandboxMode: boolean): Promise<DeviceLoginRequest[]> {
    if (!userId) return [];
    if (isSandboxMode) {
      return getSandboxRequests(userId).filter(r => r.status === 'pending');
    }
    try {
      const { data, error } = await supabase
        .from('device_login_requests')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error || !data) return [];
      return data as DeviceLoginRequest[];
    } catch {
      return [];
    }
  },

  async getPendingLoginRequestForRequester(
    userId: string,
    requesterDeviceId: string,
    isSandboxMode: boolean
  ): Promise<DeviceLoginRequest | null> {
    if (!requesterDeviceId) return null;

    if (isSandboxMode) {
      const reqs = getSandboxRequests(userId).filter(
        r => r.status === 'pending' && r.requester_device_id === requesterDeviceId
      );
      return reqs[0] || null;
    }

    try {
      let query = supabase
        .from('device_login_requests')
        .select('*')
        .eq('requester_device_id', requesterDeviceId)
        .eq('status', 'pending');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;
      return data as DeviceLoginRequest;
    } catch {
      return null;
    }
  },

  async updateLoginRequestStatus(
    requestId: string,
    status: 'approved' | 'declined' | 'expired',
    isSandboxMode: boolean,
    userId?: string,
    performingDeviceId?: string
  ): Promise<boolean> {
    if (isSandboxMode && userId) {
      const reqs = getSandboxRequests(userId);
      const idx = reqs.findIndex(r => r.id === requestId);
      if (idx >= 0) {
        const req = reqs[idx];

        // Security check 1: Requester device cannot approve/decline its own request
        if (performingDeviceId && req.requester_device_id === performingDeviceId) {
          console.warn('[DEVICE-VERIFICATION] Security violation: Requester device cannot approve/decline its own request.');
          return false;
        }

        // Security check 2: Performing device must be active primary device
        if (performingDeviceId) {
          const devs = getSandboxDevices(userId);
          const performingDev = devs.find(d => d.device_id === performingDeviceId || d.id === performingDeviceId);
          if (!performingDev || !performingDev.is_primary || performingDev.is_revoked) {
            console.warn('[DEVICE-VERIFICATION] Security violation: Non-primary device cannot respond to login requests.');
            return false;
          }
        }

        reqs[idx].status = status;
        saveSandboxRequests(userId, reqs);

        if (status === 'approved') {
          const payload: RegisterDevicePayload = {
            device_id: req.requester_device_id,
            device_fingerprint: req.requester_fingerprint,
            device_name: req.requester_device_name,
            browser: req.requester_browser,
            browser_version: '1.0',
            operating_system: req.requester_os,
            platform: 'Web',
            screen_resolution: '1920x1080',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            public_key_fingerprint: '3B:9C:12:DF'
          };
          await this.registerDevice(userId, payload, true, true);
        }

        window.dispatchEvent(new CustomEvent('sandbox_login_request_updated', { detail: reqs[idx] }));
        return true;
      }
      return false;
    }

    try {
      // Fetch request first to verify user_id and requester_device_id
      const { data: req, error: fetchErr } = await supabase
        .from('device_login_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchErr || !req) {
        console.warn('[DEVICE-VERIFICATION] Request not found for ID:', requestId);
        return false;
      }

      // Security Check 1: Requester device cannot approve/decline its own request
      if (performingDeviceId && req.requester_device_id === performingDeviceId) {
        console.warn('[DEVICE-VERIFICATION] Security violation: Requester device cannot approve/decline its own request.');
        return false;
      }

      // Security Check 2: Performing device MUST be active Primary Device for this user
      if (performingDeviceId && req.user_id) {
        const { data: performingDev } = await supabase
          .from('user_devices')
          .select('is_primary, is_revoked')
          .eq('user_id', req.user_id)
          .eq('device_id', performingDeviceId)
          .maybeSingle();

        if (!performingDev || !performingDev.is_primary || performingDev.is_revoked) {
          console.warn('[DEVICE-VERIFICATION] Security violation: Only active Primary Device is authorized to approve/decline requests.');
          return false;
        }
      }

      const { data: updatedReq, error } = await supabase
        .from('device_login_requests')
        .update({ status })
        .eq('id', requestId)
        .select()
        .single();

      if (!error && updatedReq && status === 'approved') {
        const payload: RegisterDevicePayload = {
          device_id: updatedReq.requester_device_id,
          device_fingerprint: updatedReq.requester_fingerprint,
          device_name: updatedReq.requester_device_name,
          browser: updatedReq.requester_browser,
          browser_version: '1.0',
          operating_system: updatedReq.requester_os,
          platform: 'Web',
          screen_resolution: '1920x1080',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
          public_key_fingerprint: '3B:9C:12:DF'
        };
        await this.registerDevice(updatedReq.user_id, payload, false, true);
      }

      return !error;
    } catch {
      return false;
    }
  },

  // QR LINK SESSION SERVICES
  async createQRSession(userId: string, isSandboxMode: boolean): Promise<QRLinkSession> {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 1000).toISOString();
    const token = `WA-QR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    if (isSandboxMode) {
      const session: QRLinkSession = {
        id: 'qr-sand-' + Math.random().toString(36).substring(2, 9),
        user_id: userId,
        token,
        status: 'active',
        created_at: now.toISOString(),
        expires_at: expires
      };
      localStorage.setItem(`${SANDBOX_QR_KEY}_${userId}`, JSON.stringify(session));
      return session;
    }

    try {
      const { data, error } = await supabase
        .from('qr_link_sessions')
        .insert({
          user_id: userId,
          token,
          status: 'active',
          expires_at: expires
        })
        .select()
        .single();

      if (error || !data) {
        return {
          id: 'qr-local-' + Math.random().toString(36).substring(2, 9),
          user_id: userId,
          token,
          status: 'active',
          created_at: now.toISOString(),
          expires_at: expires
        };
      }

      return data as QRLinkSession;
    } catch {
      return {
        id: 'qr-local-' + Math.random().toString(36).substring(2, 9),
        user_id: userId,
        token,
        status: 'active',
        created_at: now.toISOString(),
        expires_at: expires
      };
    }
  },

  async validateAndConsumeQRSession(token: string, isSandboxMode: boolean): Promise<{ valid: boolean; userId?: string }> {
    if (!token || !token.trim()) return { valid: false };

    if (isSandboxMode) {
      if (token.startsWith('WA-QR-')) {
        return { valid: true, userId: 'mock-user-alice-1234' };
      }
      return { valid: false };
    }

    try {
      const { data, error } = await supabase
        .from('qr_link_sessions')
        .select('*')
        .eq('token', token.trim())
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error || !data) {
        return { valid: false };
      }

      // Consume the session so it cannot be reused
      await supabase
        .from('qr_link_sessions')
        .update({ status: 'consumed' })
        .eq('id', data.id);

      return { valid: true, userId: data.user_id };
    } catch {
      return { valid: false };
    }
  }
};


