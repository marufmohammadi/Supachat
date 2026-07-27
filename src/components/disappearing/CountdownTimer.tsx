import React, { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

interface CountdownTimerProps {
  expiresAt: string;
  onExpire?: () => void;
}

export const formatCountdown = (expiresAtStr: string): { text: string; isExpired: boolean } => {
  const expiresMs = new Date(expiresAtStr).getTime();
  const nowMs = Date.now();
  const diffSec = Math.floor((expiresMs - nowMs) / 1000);

  if (diffSec <= 0) {
    return { text: 'Expired', isExpired: true };
  }

  if (diffSec < 60) {
    return { text: `${diffSec}s`, isExpired: false };
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return { text: `${diffMin}m`, isExpired: false };
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return { text: `${diffHours}h`, isExpired: false };
  }

  const diffDays = Math.floor(diffHours / 24);
  return { text: `${diffDays}d`, isExpired: false };
};

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ expiresAt, onExpire }) => {
  const [countdownText, setCountdownText] = useState<string>('');
  const [isExpired, setIsExpired] = useState<boolean>(false);

  useEffect(() => {
    const update = () => {
      const { text, isExpired: expired } = formatCountdown(expiresAt);
      setCountdownText(text);
      setIsExpired(expired);

      if (expired && onExpire) {
        onExpire();
      }
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  if (isExpired) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-mono font-semibold">
        <Timer className="w-3 h-3" /> Expired
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-mono font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
      <Timer className="w-3 h-3 animate-pulse text-amber-400" /> {countdownText}
    </span>
  );
};
