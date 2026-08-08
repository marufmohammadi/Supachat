import { useState, useEffect, useCallback, useRef } from 'react';
import { NewDeviceAlert, UserDevice, DeviceLoginRequest } from '../types';
import { getDeviceFingerprintDetails } from '../utils/deviceFingerprint';
import { deviceService } from '../services/deviceService';
import { supabase } from '../../../lib/supabase';

interface UseDeviceVerificationProps {
  currentUserId: string;
  isSandboxMode: boolean;
  onForceLogout?: () => void;
}

export function useDeviceVerification({ currentUserId, isSandboxMode, onForceLogout }: UseDeviceVerificationProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<UserDevice | null>(null);
  const [newDeviceAlert, setNewDeviceAlert] = useState<NewDeviceAlert | null>(null);
  const [pendingLoginRequest, setPendingLoginRequest] = useState<DeviceLoginRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasRegisteredRef = useRef(false);

  const refreshDevices = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      const list = await deviceService.getLinkedDevices(currentUserId, isSandboxMode);
      setDevices(list);
    } catch (err) {
      console.warn('[DEVICE-HOOK] Failed fetching devices:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, isSandboxMode]);

  useEffect(() => {
    if (!currentUserId || hasRegisteredRef.current) return;
    hasRegisteredRef.current = true;

    const registerAsync = async () => {
      try {
        const payload = getDeviceFingerprintDetails(currentUserId);
        const { device, isNewDevice } = await deviceService.registerDevice(
          currentUserId,
          payload,
          isSandboxMode
        );

        setCurrentDevice(device);

        const allDevices = await deviceService.getLinkedDevices(currentUserId, isSandboxMode);
        setDevices(allDevices);

        // If newly linked device and there are multiple devices registered, trigger alert
        if (isNewDevice && allDevices.length > 1) {
          setNewDeviceAlert({
            id: device.id,
            device_name: device.device_name,
            browser: `${device.browser} ${device.browser_version}`,
            operating_system: device.operating_system,
            login_time: new Date(device.login_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
          });
        }
      } catch (err) {
        console.warn('[DEVICE-HOOK] Registration safe warning:', err);
      } finally {
        setLoading(false);
      }
    };

    registerAsync();
  }, [currentUserId, isSandboxMode]);

  // ACTIVE DEVICE HEARTBEAT (keeps last_active fresh every 25s while session is active)
  useEffect(() => {
    if (!currentUserId || !currentDevice) return;

    deviceService.updateHeartbeat(currentUserId, currentDevice.device_id, isSandboxMode);

    const interval = setInterval(() => {
      deviceService.updateHeartbeat(currentUserId, currentDevice.device_id, isSandboxMode);
    }, 25000);

    return () => {
      clearInterval(interval);
    };
  }, [currentUserId, currentDevice, isSandboxMode]);

  // INSTANT DEVICE REVOCATION LISTENER (Fixes bug where revoked device stayed logged in)
  useEffect(() => {
    if (!currentUserId || !currentDevice) return;

    let securityChannel: any = null;
    let tableChannel: any = null;

    const executeForceLogout = async () => {
      console.warn('[DEVICE-HOOK] Current device session revoked! Executing instant force logout...');
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (err) {
        console.warn('[DEVICE-HOOK] signOut error:', err);
      }
      localStorage.clear();
      sessionStorage.clear();

      if (securityChannel) supabase.removeChannel(securityChannel);
      if (tableChannel) supabase.removeChannel(tableChannel);

      if (onForceLogout) {
        onForceLogout();
      } else {
        window.location.reload();
      }
    };

    // Sandbox event listener
    const handleSandboxRevoked = (e: CustomEvent) => {
      const revokedId = e.detail?.deviceId;
      if (revokedId === currentDevice.id) {
        console.warn('[DEVICE-HOOK] This device was revoked in Sandbox mode. Logging out...');
        executeForceLogout();
      }
    };

    window.addEventListener('sandbox_device_revoked', handleSandboxRevoked as EventListener);

    if (!isSandboxMode) {
      // Broadcast channel for instant force logout signal
      securityChannel = supabase
        .channel(`device_security_${currentUserId}`)
        .on('broadcast', { event: 'force_logout' }, payload => {
          const revokedId = payload?.payload?.deviceId;
          if (revokedId === currentDevice.id || !revokedId) {
            executeForceLogout();
          }
        })
        .subscribe();

      // Postgres changes listener on user_devices table
      tableChannel = supabase
        .channel(`user_devices_revocation_${currentUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_devices',
            filter: `user_id=eq.${currentUserId}`
          },
          payload => {
            const updated = payload.new as any;
            const deleted = payload.old as any;

            // If current device was marked is_revoked = true or deleted
            if (
              (updated && (updated.id === currentDevice.id || updated.device_fingerprint === currentDevice.device_fingerprint) && updated.is_revoked) ||
              (payload.eventType === 'DELETE' && deleted && (deleted.id === currentDevice.id || deleted.device_fingerprint === currentDevice.device_fingerprint))
            ) {
              executeForceLogout();
            } else {
              // Refresh linked devices list if another device changed
              refreshDevices();
            }
          }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('sandbox_device_revoked', handleSandboxRevoked as EventListener);
      if (securityChannel) supabase.removeChannel(securityChannel);
      if (tableChannel) supabase.removeChannel(tableChannel);
    };
  }, [currentUserId, currentDevice, isSandboxMode, onForceLogout, refreshDevices]);

  // PRIMARY DEVICE LOGIN REQUESTS LISTENER
  useEffect(() => {
    if (!currentUserId || !currentDevice) return;

    // Only listen if this is the Primary Device
    const isPrimary = currentDevice.is_primary || (devices.length > 0 && devices[0]?.id === currentDevice.id);
    if (!isPrimary) return;

    // Query initial pending login requests on mount/listener init
    deviceService.getPendingLoginRequests(currentUserId, isSandboxMode).then(reqs => {
      if (reqs && reqs.length > 0) {
        setPendingLoginRequest(reqs[0]);
      }
    });

    // Sandbox listener
    const handleSandboxRequestCreated = (e: CustomEvent) => {
      const req = e.detail as DeviceLoginRequest;
      if (req && req.user_id === currentUserId && req.status === 'pending') {
        setPendingLoginRequest(req);
      }
    };

    window.addEventListener('sandbox_login_request_created', handleSandboxRequestCreated as EventListener);

    // Realtime Supabase listener
    let channel: any = null;
    if (!isSandboxMode) {
      channel = supabase
        .channel(`device_login_requests_${currentUserId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'device_login_requests',
            filter: `user_id=eq.${currentUserId}`
          },
          payload => {
            const req = payload.new as DeviceLoginRequest;
            if (req && req.status === 'pending') {
              setPendingLoginRequest(req);
            } else if (req && req.status !== 'pending') {
              setPendingLoginRequest(prev => prev?.id === req.id ? null : prev);
            }
          }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener('sandbox_login_request_created', handleSandboxRequestCreated as EventListener);
      if (channel) supabase.removeChannel(channel);
    };
  }, [currentUserId, currentDevice, devices, isSandboxMode]);

  const approveRequest = useCallback(async (requestId: string) => {
    const success = await deviceService.updateLoginRequestStatus(requestId, 'approved', isSandboxMode, currentUserId);
    if (success) {
      setPendingLoginRequest(null);
      refreshDevices();
    }
    return success;
  }, [currentUserId, isSandboxMode, refreshDevices]);

  const declineRequest = useCallback(async (requestId: string) => {
    const success = await deviceService.updateLoginRequestStatus(requestId, 'declined', isSandboxMode, currentUserId);
    if (success) {
      setPendingLoginRequest(null);
    }
    return success;
  }, [currentUserId, isSandboxMode]);

  const logoutDevice = useCallback(async (deviceTableId: string) => {
    if (!currentUserId) return false;
    const success = await deviceService.logoutDevice(currentUserId, deviceTableId, isSandboxMode);
    if (success) {
      setDevices(prev => prev.filter(d => d.id !== deviceTableId));
    }
    return success;
  }, [currentUserId, isSandboxMode]);

  const dismissAlert = useCallback(() => {
    setNewDeviceAlert(null);
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const isPrimaryDevice = Boolean(
    currentDevice?.is_primary || (devices.length > 0 && devices[0]?.id === currentDevice?.id)
  );

  return {
    devices,
    currentDevice,
    isPrimaryDevice,
    newDeviceAlert,
    pendingLoginRequest,
    loading,
    isModalOpen,
    openModal,
    closeModal,
    refreshDevices,
    logoutDevice,
    approveRequest,
    declineRequest,
    dismissAlert
  };
}

