import React, { useState } from 'react';
import { UserDevice } from '../types';
import { 
  Laptop, 
  Smartphone, 
  Monitor, 
  ShieldCheck, 
  LogOut, 
  X, 
  Clock, 
  Key, 
  CheckCircle2, 
  AlertTriangle,
  Globe,
  RefreshCw,
  QrCode,
  Crown,
  Lock
} from 'lucide-react';
import { QRCodeModal } from './QRCodeModal';

interface LinkedDevicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: UserDevice[];
  currentDevice: UserDevice | null;
  isPrimaryDevice: boolean;
  userId: string;
  isSandboxMode: boolean;
  onLogoutDevice: (deviceTableId: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  loading: boolean;
}

export const LinkedDevicesModal: React.FC<LinkedDevicesModalProps> = ({
  isOpen,
  onClose,
  devices,
  currentDevice,
  isPrimaryDevice,
  userId,
  isSandboxMode,
  onLogoutDevice,
  onRefresh,
  loading
}) => {
  const [deviceToLogout, setDeviceToLogout] = useState<UserDevice | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  if (!isOpen) return null;

  const handleConfirmLogout = async () => {
    if (!deviceToLogout) return;
    setIsLoggingOut(true);
    try {
      await onLogoutDevice(deviceToLogout.id);
      setDeviceToLogout(null);
    } catch (err) {
      console.error('Error logging out device:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  };

  const getDeviceIcon = (platform: string, os: string) => {
    const p = (platform || '').toLowerCase();
    const o = (os || '').toLowerCase();

    if (p.includes('mobile') || o.includes('ios') || o.includes('android')) {
      return <Smartphone className="w-5 h-5 text-emerald-400" />;
    }
    if (o.includes('mac') || o.includes('win') || o.includes('linux')) {
      return <Laptop className="w-5 h-5 text-emerald-400" />;
    }
    return <Monitor className="w-5 h-5 text-emerald-400" />;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Recently';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + 
             ' at ' + 
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  // Identify current device vs other devices
  const isThisDevice = (d: UserDevice) => {
    if (currentDevice && currentDevice.id === d.id) return true;
    if (currentDevice && currentDevice.device_fingerprint === d.device_fingerprint) return true;
    return false;
  };

  const activeCurrentDevice = currentDevice || devices.find(d => isThisDevice(d)) || devices[0];
  const otherDevices = devices.filter(d => d.id !== activeCurrentDevice?.id && d.device_fingerprint !== activeCurrentDevice?.device_fingerprint);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
        <div 
          id="linked-devices-modal"
          className="w-full max-w-lg bg-[#111b21] border border-[#222e35] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 border-b border-[#222e35] bg-[#202c33] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-base leading-snug">Linked Devices</h3>
                  {isPrimaryDevice ? (
                    <span className="px-2 py-0.5 text-[10px] bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold rounded-full flex items-center gap-1">
                      <Crown className="w-3 h-3 text-amber-400" /> Primary Device
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold rounded-full flex items-center gap-1">
                      <Lock className="w-3 h-3 text-blue-400" /> Linked Device
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">Manage device security & active sessions</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                id="refresh-devices-btn"
                onClick={handleRefreshClick}
                disabled={isRefreshing || loading}
                title="Refresh Devices"
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-full transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
              <button
                id="close-linked-devices-btn"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 text-left">
            {/* Primary Device Link Action Bar */}
            {isPrimaryDevice ? (
              <div className="p-4 bg-gradient-to-r from-[#1f2c34] to-[#128c7e]/20 border border-[#00a884]/30 rounded-xl flex items-center justify-between gap-3 shadow-md">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <QrCode className="w-4 h-4 text-[#00a884]" /> Link a New Device
                  </h4>
                  <p className="text-[11px] text-gray-300 mt-0.5">
                    Generate a one-time QR code to authorize another web browser or app.
                  </p>
                </div>
                <button
                  id="generate-qr-link-btn"
                  onClick={() => setShowQRModal(true)}
                  className="px-3.5 py-2 bg-[#00a884] hover:bg-[#008f72] text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer shrink-0 flex items-center gap-1.5"
                >
                  <QrCode className="w-4 h-4" /> Link Device
                </button>
              </div>
            ) : (
              <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs rounded-xl flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Linked Device Notice:</strong> You are using a secondary linked device. Only your Primary Device can approve new devices, generate QR links, or remove active sessions.
                </p>
              </div>
            )}

            {/* Security Banner */}
            <div className="p-3.5 bg-[#1f2c34] border border-[#2a3942] rounded-xl flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-gray-300 leading-relaxed">
                <span className="font-semibold text-emerald-300 block mb-0.5">End-to-End Encrypted Verification</span>
                Your messages, voice calls, and media are end-to-end encrypted across all your verified linked devices.
              </div>
            </div>

            {/* Current Device Section */}
            <div>
              <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-2.5 px-1">
                This Device
              </h4>

              {activeCurrentDevice ? (
                <div className="p-4 bg-[#1f2c34] border border-emerald-500/30 rounded-xl space-y-3 relative overflow-hidden shadow-lg shadow-emerald-950/20">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3 items-center">
                      <div className="p-2.5 bg-emerald-500/15 rounded-xl">
                        {getDeviceIcon(activeCurrentDevice.platform, activeCurrentDevice.operating_system)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="font-semibold text-white text-sm">
                            {activeCurrentDevice.device_name}
                          </h5>
                          <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold rounded-full flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            This Device
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {activeCurrentDevice.browser} • {activeCurrentDevice.operating_system} ({activeCurrentDevice.platform})
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50 text-xs">
                    <div>
                      <span className="text-gray-400 block mb-0.5 text-[11px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-500" /> First Linked
                      </span>
                      <span className="text-gray-200 font-medium">
                        {formatDate(activeCurrentDevice.created_at || activeCurrentDevice.login_time)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block mb-0.5 text-[11px] flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Status
                      </span>
                      <span className="text-emerald-400 font-medium">Active Now</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-700/50 flex items-center justify-between text-xs">
                    <span className="text-gray-400 flex items-center gap-1 text-[11px]">
                      <Key className="w-3 h-3 text-amber-400" /> Device ID
                    </span>
                    <span className="font-mono text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40 text-[11px]">
                      {activeCurrentDevice.public_key_fingerprint || '4A:8B:12:9F:C3'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-[#1f2c34] rounded-xl text-center text-xs text-gray-400">
                  Registering current device...
                </div>
              )}
            </div>

            {/* Other Devices Section */}
            <div>
              <div className="flex items-center justify-between mb-2.5 px-1">
                <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold">
                  Other Linked Devices ({otherDevices.length})
                </h4>
              </div>

              {otherDevices.length === 0 ? (
                <div className="p-6 bg-[#1f2c34]/50 border border-dashed border-gray-700/60 rounded-xl text-center text-xs text-gray-400 space-y-1">
                  <Globe className="w-6 h-6 text-gray-500 mx-auto mb-1 opacity-60" />
                  <p className="font-medium text-gray-300">No other devices linked</p>
                  <p className="text-[11px] text-gray-500">Signing into your account on another browser or device will list it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {otherDevices.map(device => (
                    <div 
                      key={device.id}
                      className="p-3.5 bg-[#1f2c34] border border-[#2a3942] rounded-xl space-y-2.5 transition-all hover:border-gray-600"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex gap-3 items-center">
                          <div className="p-2 bg-gray-800 rounded-lg">
                            {getDeviceIcon(device.platform, device.operating_system)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h5 className="font-semibold text-white text-sm">
                                {device.device_name}
                              </h5>
                              {device.is_primary && (
                                <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/20 text-amber-300 font-bold rounded">Primary</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {device.browser} • {device.operating_system}
                            </p>
                          </div>
                        </div>

                        {isPrimaryDevice ? (
                          <button
                            id={`logout-device-btn-${device.id}`}
                            onClick={() => setDeviceToLogout(device)}
                            className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <LogOut className="w-3.5 h-3.5" /> Log Out
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-500 italic">Protected</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50 text-xs">
                        <div>
                          <span className="text-gray-400 block mb-0.5 text-[11px]">Last Active</span>
                          <span className="text-gray-300">{formatDate(device.last_active)}</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block mb-0.5 text-[11px]">Device ID</span>
                          <span className="font-mono text-gray-300 text-[11px]">
                            {device.public_key_fingerprint || '8C:1F:33:AA'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirmation Dialog for Unlinking/Logging Out */}
        {deviceToLogout && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-md bg-[#1f2c34] border border-[#2a3942] rounded-2xl p-5 space-y-4 shadow-2xl text-left">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-500/15 rounded-xl text-rose-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-white text-base">Remove Linked Device?</h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Are you sure you want to log out <strong className="text-gray-200">{deviceToLogout.device_name}</strong>?
                  </p>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed bg-[#111b21] p-3 rounded-xl border border-gray-800">
                This session will be terminated immediately. The device will lose access and be forced to the login screen.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  id="cancel-logout-device-btn"
                  onClick={() => setDeviceToLogout(null)}
                  disabled={isLoggingOut}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="confirm-logout-device-btn"
                  onClick={handleConfirmLogout}
                  disabled={isLoggingOut}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isLoggingOut ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Logging out...
                    </>
                  ) : (
                    <>
                      <LogOut className="w-3.5 h-3.5" /> Logout Device
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* QR Code Modal Generator */}
      <QRCodeModal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        userId={userId}
        isSandboxMode={isSandboxMode}
      />
    </>
  );
};

