import { useState, useEffect, useCallback, useRef } from 'react';
import { NewDeviceAlert, UserDevice } from '../types';
import { getDeviceFingerprintDetails } from '../utils/deviceFingerprint';
import { deviceService } from '../services/deviceService';

interface UseDeviceVerificationProps {
  currentUserId: string;
  isSandboxMode: boolean;
}

export function useDeviceVerification({ currentUserId, isSandboxMode }: UseDeviceVerificationProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [currentDevice, setCurrentDevice] = useState<UserDevice | null>(null);
  const [newDeviceAlert, setNewDeviceAlert] = useState<NewDeviceAlert | null>(null);
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

  return {
    devices,
    currentDevice,
    newDeviceAlert,
    loading,
    isModalOpen,
    openModal,
    closeModal,
    refreshDevices,
    logoutDevice,
    dismissAlert
  };
}
