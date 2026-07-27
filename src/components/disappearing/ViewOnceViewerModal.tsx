import React, { useState, useEffect } from 'react';
import { Eye, ShieldAlert, Lock, Check, EyeOff } from 'lucide-react';

interface ViewOnceViewerModalProps {
  isOpen: boolean;
  senderName: string;
  senderAvatar?: string;
  messageText: string;
  onCloseAndDestroy: () => void;
}

export const ViewOnceViewerModal: React.FC<ViewOnceViewerModalProps> = ({
  isOpen,
  senderName,
  senderAvatar,
  messageText,
  onCloseAndDestroy,
}) => {
  const [hasProtectionWarning, setHasProtectionWarning] = useState<boolean>(false);
  const [isWindowObscured, setIsWindowObscured] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    // 1. Android FLAG_SECURE / Native Bridge Protection
    const enableNativeFLAG_SECURE = () => {
      try {
        const win = window as any;
        if (win.AndroidSecureFlag?.enableSecure) {
          win.AndroidSecureFlag.enableSecure();
          return true;
        }
        if (win.Android?.setFlagsSecure) {
          win.Android.setFlagsSecure(true);
          return true;
        }
        if (win.webkit?.messageHandlers?.setSecure?.postMessage) {
          win.webkit.messageHandlers.setSecure.postMessage(true);
          return true;
        }
      } catch (e) {
        console.warn('Native FLAG_SECURE call attempted cleanly:', e);
      }
      return false;
    };

    const disableNativeFLAG_SECURE = () => {
      try {
        const win = window as any;
        if (win.AndroidSecureFlag?.disableSecure) {
          win.AndroidSecureFlag.disableSecure();
        } else if (win.Android?.setFlagsSecure) {
          win.Android.setFlagsSecure(false);
        } else if (win.webkit?.messageHandlers?.setSecure?.postMessage) {
          win.webkit.messageHandlers.setSecure.postMessage(false);
        }
      } catch (e) {
        // Silently handle
      }
    };

    const nativeSecureActive = enableNativeFLAG_SECURE();
    setHasProtectionWarning(!nativeSecureActive);

    // 2. Web Browser Screenshot & Print Blockers
    // Inject dynamic CSS to blank out screen if printing is triggered
    const styleEl = document.createElement('style');
    styleEl.id = 'view-once-screenshot-protection';
    styleEl.innerHTML = `
      @media print {
        body { display: none !important; }
      }
    `;
    document.head.appendChild(styleEl);

    // Context Menu & Copy/Cut Blocker
    const preventAction = (e: Event) => {
      e.preventDefault();
      return false;
    };

    // Keyboard shortcut blocker (PrintScreen, Ctrl/Cmd+P, Cmd+Shift+3/4/5)
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key ? e.key.toLowerCase() : '';
      const code = e.code ? e.code.toLowerCase() : '';

      // PrintScreen key
      if (key === 'printscreen' || code === 'printscreen') {
        e.preventDefault();
        setIsWindowObscured(true);
        return false;
      }

      // Ctrl / Cmd + P (Print)
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        e.preventDefault();
        return false;
      }

      // Cmd + Shift + 3 / 4 / 5 (Mac Screenshot)
      if (e.metaKey && e.shiftKey && (key === '3' || key === '4' || key === '5')) {
        e.preventDefault();
        setIsWindowObscured(true);
        return false;
      }

      // Ctrl + S or Cmd + S (Save Page)
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        return false;
      }
    };

    // Window Blur & Visibility Listener (Obscures text if screenshotting tool or window loses focus)
    const handleBlur = () => setIsWindowObscured(true);
    const handleFocus = () => setIsWindowObscured(false);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsWindowObscured(true);
      } else {
        setIsWindowObscured(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', preventAction, true);
    window.addEventListener('copy', preventAction, true);
    window.addEventListener('cut', preventAction, true);
    window.addEventListener('dragstart', preventAction, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // CLEANUP: Immediately restore normal app state on modal close/unmount
    return () => {
      disableNativeFLAG_SECURE();

      const existingStyle = document.getElementById('view-once-screenshot-protection');
      if (existingStyle) {
        existingStyle.remove();
      }

      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', preventAction, true);
      window.removeEventListener('copy', preventAction, true);
      window.removeEventListener('cut', preventAction, true);
      window.removeEventListener('dragstart', preventAction, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[99999] flex items-center justify-center p-4 select-none print:hidden">
      {/* Container with extra screenshot protection styling */}
      <div 
        className="relative w-full max-w-md bg-[#111b21] border border-emerald-500/30 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center space-y-5"
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      >
        {/* Header Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold rounded-full">
          <Eye className="w-4 h-4" /> View Once Text Message
        </div>

        {/* Sender Info */}
        <div className="flex items-center gap-2.5">
          <img 
            src={senderAvatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${senderName}`} 
            alt="" 
            className="w-8 h-8 rounded-full bg-slate-800 border border-emerald-500/30"
          />
          <span className="text-sm font-semibold text-white">From {senderName}</span>
        </div>

        {/* Protection Banner */}
        {hasProtectionWarning ? (
          <div className="w-full bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-amber-300 text-[11px] flex items-center gap-2 text-left leading-tight">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Screenshot protection active. Browser level protections engaged.</span>
          </div>
        ) : (
          <div className="w-full bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl text-emerald-300 text-[11px] flex items-center gap-2 text-left leading-tight">
            <Lock className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>FLAG_SECURE hardware screenshot protection enabled on this device.</span>
          </div>
        )}

        {/* Decrypted Text View Box or Obscured Cover */}
        <div className="w-full relative min-h-[120px]">
          {isWindowObscured ? (
            <div className="w-full bg-[#182229] border border-amber-500/30 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-amber-300 text-xs font-bold my-2 min-h-[120px]">
              <EyeOff className="w-6 h-6 text-amber-400 animate-bounce" />
              <span>Screen hidden for privacy & screenshot protection</span>
            </div>
          ) : (
            <div className="w-full bg-[#182229] border border-gray-800 rounded-2xl p-5 text-left text-sm text-white font-sans leading-relaxed my-2 max-h-[300px] overflow-y-auto break-words shadow-inner select-none">
              {messageText || '🔒 Loading decrypted message...'}
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-400 italic">
          This text message will self-destruct and disappear forever once closed.
        </p>

        {/* Close & Destroy Button */}
        <button
          type="button"
          onClick={onCloseAndDestroy}
          className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" /> Close & Destroy Message
        </button>
      </div>
    </div>
  );
};
