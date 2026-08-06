import React from 'react';

interface SplashScreenProps {
  fadeOut?: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ fadeOut = false }) => {
  return (
    <div
      className={`fixed inset-0 bg-[#08131A] flex flex-col items-center justify-between py-12 px-4 z-[99999] select-none font-sans overflow-hidden transition-opacity duration-200 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{ backgroundColor: '#08131A' }}
    >
      {/* Background Soft Ambient Green Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-[#00a884]/15 rounded-full blur-3xl pointer-events-none animate-splash-glow" />

      {/* Top Spacer */}
      <div className="h-4" />

      {/* Center Brand Identity */}
      <div className="flex flex-col items-center justify-center text-center z-10 space-y-5">
        {/* Logo Icon with Soft Glowing Frame */}
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 bg-[#00a884]/25 rounded-3xl blur-md scale-110 pointer-events-none" />
          <div className="relative w-20 h-20 bg-gradient-to-br from-[#1f2c34] to-[#111b21] border border-[#00a884]/30 rounded-3xl flex items-center justify-center shadow-[0_0_35px_rgba(0,168,132,0.25)] text-[#00a884]">
            <svg
              className="w-10 h-10 text-[#00a884]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
        </div>

        {/* Brand Text */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-extrabold text-white tracking-[0.25em] font-sans">
            SUPACHAT
          </h1>
          <p className="text-xs font-medium text-gray-400 tracking-wider">
            Secure • Fast • Private
          </p>
        </div>

        {/* WhatsApp-Style Smooth Animated Dot Loader */}
        <div className="flex items-center gap-2 pt-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#00a884] animate-dot-pulse-1" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#00a884] animate-dot-pulse-2" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#00a884] animate-dot-pulse-3" />
        </div>
      </div>

      {/* Footer Branding */}
      <div className="z-10 flex flex-col items-center justify-center text-center space-y-0.5">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
          from
        </span>
        <span className="text-sm font-bold text-white tracking-wider">
          Mofinity
        </span>
        <span className="text-[11px] text-gray-400 font-normal tracking-wide">
          Infinite Innovation.
        </span>
      </div>
    </div>
  );
};

export default SplashScreen;
