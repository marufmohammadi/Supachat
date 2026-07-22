import React, { useState, useEffect } from 'react';
import { ShieldCheck, Laptop, Smartphone, Monitor, AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { DeviceLoginRequest } from '../types';

interface LoginApprovalModalProps {
  request: DeviceLoginRequest | null;
  onApprove: (requestId: string) => Promise<boolean>;
  onDecline: (requestId: string) => Promise<boolean>;
}

export const LoginApprovalModal: React.FC<LoginApprovalModalProps> = ({
  request,
  onApprove,
  onDecline
}) => {
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);

  useEffect(() => {
    if (!request) return;
    setTimeLeft(60);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onDecline(request.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request]);

  if (!request) return null;

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(request.id);
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    setLoading(true);
    try {
      await onDecline(request.id);
    } finally {
      setLoading(false);
    }
  };

  const getDeviceIcon = (os: string) => {
    const o = (os || '').toLowerCase();
    if (o.includes('ios') || o.includes('android')) return <Smartphone className="w-6 h-6 text-emerald-400" />;
    return <Laptop className="w-6 h-6 text-emerald-400" />;
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-[#1f2c34] border border-emerald-500/50 rounded-2xl p-6 shadow-2xl space-y-5 text-left relative overflow-hidden">
        {/* Glow Header */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600 animate-pulse" />

        <div className="flex items-start gap-3.5">
          <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-400 shrink-0 mt-0.5">
            <ShieldCheck className="w-7 h-7 animate-bounce-subtle" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
              Security Alert • Action Required
            </span>
            <h3 className="font-bold text-white text-lg mt-1 leading-snug">
              Approve New Device Login?
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Someone is trying to sign into your WhatsApp account.
            </p>
          </div>
        </div>

        {/* Device Information Card */}
        <div className="p-4 bg-[#111b21] border border-gray-700/60 rounded-xl space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-800 rounded-lg">
              {getDeviceIcon(request.requester_os)}
            </div>
            <div>
              <h4 className="font-semibold text-white text-sm">
                {request.requester_device_name || 'Web Browser'}
              </h4>
              <p className="text-xs text-gray-400">
                {request.requester_browser} on {request.requester_os}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Timeout
            </span>
            <span className="font-mono text-amber-400 font-bold">
              {timeLeft} seconds remaining
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-1">
          <button
            id="decline-device-login-btn"
            onClick={handleDecline}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <XCircle className="w-4 h-4" /> Decline
          </button>

          <button
            id="approve-device-login-btn"
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-emerald-950/40 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" /> Approve Device
          </button>
        </div>
      </div>
    </div>
  );
};
