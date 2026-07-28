import React, { useState, useEffect } from 'react';
import { QrCode, X, RefreshCw, Clock, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { QRLinkSession } from '../types';
import { deviceService } from '../services/deviceService';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  isSandboxMode: boolean;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  userId,
  isSandboxMode
}) => {
  const [session, setSession] = useState<QRLinkSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);

  const generateNewQR = async () => {
    setLoading(true);
    try {
      const qr = await deviceService.createQRSession(userId, isSandboxMode);
      setSession(qr);
      setTimeLeft(60);
    } catch (err) {
      console.error('Error generating QR link session:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && userId) {
      generateNewQR();
    }
  }, [isOpen, userId]);

  useEffect(() => {
    if (!session || timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [session, timeLeft]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222e35] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-left">
        {/* Header */}
        <div className="p-4 border-b border-[#222e35] bg-[#202c33] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/15 rounded-lg text-emerald-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base leading-snug">Link New Device</h3>
              <p className="text-xs text-gray-400">Scan code on your secondary device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-center flex flex-col items-center">
          <p className="text-xs text-gray-300 max-w-xs leading-relaxed">
            Open SupaChat on your secondary device, tap <strong className="text-emerald-400">⋮ -&gt; Scan QR Code</strong> and scan or enter this one-time code.
          </p>

          {/* QR Container */}
          <div className="p-5 bg-white rounded-2xl shadow-2xl relative flex flex-col items-center justify-center border-4 border-emerald-500/30">
            {loading ? (
              <div className="w-48 h-48 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
              </div>
            ) : timeLeft === 0 ? (
              <div className="w-48 h-48 flex flex-col items-center justify-center bg-gray-100 rounded-xl p-4 text-gray-700 gap-2">
                <Clock className="w-8 h-8 text-rose-500" />
                <span className="text-xs font-semibold text-rose-600">QR Code Expired</span>
                <button
                  onClick={generateNewQR}
                  className="mt-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  Generate New QR
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {/* SVG Visual QR representation */}
                <div className="p-2 bg-slate-950 rounded-xl text-white">
                  <svg className="w-40 h-40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 0h30v30H0zM70 0h30v30H70zM0 70h30v30H0z" fill="#000" />
                    <path d="M5 5h20v20H5zM75 5h20v20H75zM5 75h20v20H5z" fill="#fff" />
                    <path d="M10 10h10v10H10zM80 10h10v10H80zM10 80h10v10H10z" fill="#000" />
                    <path d="M40 0h20v10H40zM30 20h20v10H30zM0 40h10v20H0zM20 40h20v10H20zM50 40h10v30H50zM70 40h30v10H70zM40 60h20v10H40zM70 60h10v30H70zM90 70h10v20H90z" fill="#000" />
                  </svg>
                </div>

                <div className="bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-800">Session Token</span>
                  <p className="font-mono font-bold text-xs text-emerald-950 tracking-wider">
                    {session?.token || 'WA-QR-LOADING'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Timer Indicator */}
          {session && timeLeft > 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-400 font-medium bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20">
              <Clock className="w-3.5 h-3.5 animate-pulse" />
              <span>Expires in <strong className="text-white font-mono">{timeLeft}s</strong></span>
            </div>
          )}

          {/* Security Note */}
          <div className="flex items-center gap-2 text-[11px] text-gray-400 border-t border-gray-800 pt-3 w-full justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Encrypted single-use link token. Never shares private keys.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
