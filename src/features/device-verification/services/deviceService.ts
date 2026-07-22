import { supabase } from '../../../lib/supabase';
import { RegisterDevicePayload, UserDevice } from '../types';

const SANDBOX_DEVICES_KEY = 'whatsapp_sandbox_user_devices';

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

export const deviceService = {
  async registerDevice(
    userId: string,
    payload: RegisterDevicePayload,
    isSandboxMode: boolean
  ): Promise<{ device: UserDevice; isNewDevice: boolean }> {
    const nowIso = new Date().toISOString();

    if (isSandboxMode) {
      const existingDevices = getSandboxDevices(userId);
      const existingIndex = existingDevices.findIndex(
        d => d.device_fingerprint === payload.device_fingerprint
      );

      if (existingIndex >= 0) {
        const existing = existingDevices[existingIndex];
        const updated: UserDevice = {
          ...existing,
          device_id: payload.device_id,
          last_active: nowIso,
          login_time: nowIso,
          login_count: (existing.login_count || 1) + 1,
          public_key_fingerprint: payload.public_key_fingerprint,
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
          created_at: nowIso,
          updated_at: nowIso
        };
        existingDevices.push(newDevice);
        saveSandboxDevices(userId, existingDevices);
        return { device: newDevice, isNewDevice: true };
      }
    }

    try {
      // 1. Check if user device exists with this fingerprint
      const { data: existing, error: fetchError } = await supabase
        .from('user_devices')
        .select('*')
        .eq('user_id', userId)
        .eq('device_fingerprint', payload.device_fingerprint)
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
          login_count: 1
        };

        const { data: inserted, error: insertError } = await supabase
          .from('user_devices')
          .insert(newRecord)
          .select()
          .single();

        if (insertError || !inserted) {
          console.warn('[DEVICE-VERIFICATION] Insert error or schema missing:', insertError?.message);
          // Fallback return
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
      // Ensure registration never crashes login
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
        created_at: nowIso,
        updated_at: nowIso
      };
      return { device: fallback, isNewDevice: true };
    }
  },

  async getLinkedDevices(userId: string, isSandboxMode: boolean): Promise<UserDevice[]> {
    if (isSandboxMode) {
      return getSandboxDevices(userId);
    }

    try {
      const { data, error } = await supabase
        .from('user_devices')
        .select('*')
        .eq('user_id', userId)
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

  async logoutDevice(userId: string, deviceTableId: string, isSandboxMode: boolean): Promise<boolean> {
    if (isSandboxMode) {
      const list = getSandboxDevices(userId).filter(d => d.id !== deviceTableId);
      saveSandboxDevices(userId, list);
      return true;
    }

    try {
      const { error } = await supabase
        .from('user_devices')
        .delete()
        .eq('id', deviceTableId)
        .eq('user_id', userId);

      if (error) {
        console.error('[DEVICE-VERIFICATION] Logout device error:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[DEVICE-VERIFICATION] Logout device catch:', err);
      return false;
    }
  }
};
