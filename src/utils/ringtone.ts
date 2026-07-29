// WhatsApp-style Ringtone & Vibration Manager using Web Audio API + HTML5 Audio Fallback
class RingtoneManager {
  private audioCtx: AudioContext | null = null;
  private isRinging: boolean = false;
  private intervalId: any = null;
  private vibrateIntervalId: any = null;
  private fallbackAudio: HTMLAudioElement | null = null;

  public playRingtone() {
    if (this.isRinging) return;
    this.isRinging = true;

    // 1. Vibration
    this.startVibration();

    // 2. Synthesize audio ringtone via Web Audio API (reliable across all devices without external file dependencies)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }

        const playBurst = () => {
          if (!this.isRinging || !this.audioCtx) return;
          try {
            const ctx = this.audioCtx;
            const now = ctx.currentTime;

            // Frequency 1: 440Hz (Standard Dial tone high)
            const osc1 = ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(440, now);

            // Frequency 2: 480Hz
            const osc2 = ctx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(480, now);

            const gain = ctx.createGain();
            // Pulse pattern: 0.8s on, 0.2s soft, 0.8s on, 1.5s silence
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.setValueAtTime(0.25, now + 0.8);
            gain.gain.setValueAtTime(0.05, now + 0.9);
            gain.gain.setValueAtTime(0.25, now + 1.0);
            gain.gain.setValueAtTime(0, now + 1.8);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 1.8);
            osc2.stop(now + 1.8);
          } catch (e) {
            console.warn('[RINGTONE] Audio context burst error:', e);
          }
        };

        // Play immediate first burst
        playBurst();
        // Repeat every 3 seconds
        this.intervalId = setInterval(playBurst, 3000);
        return;
      }
    } catch (err) {
      console.warn('[RINGTONE] Web Audio API failed, trying HTML5 audio fallback:', err);
    }

    // Fallback: HTML5 Audio
    try {
      if (!this.fallbackAudio) {
        this.fallbackAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/1359/1359-84.wav');
        this.fallbackAudio.loop = true;
      }
      this.fallbackAudio.play().catch((e) => console.log('[RINGTONE] Fallback audio play policy block:', e));
    } catch (e) {
      console.warn('[RINGTONE] Fallback audio exception:', e);
    }
  }

  private startVibration() {
    if ('vibrate' in navigator) {
      const triggerVibe = () => {
        if (!this.isRinging) return;
        try {
          navigator.vibrate([1000, 500, 1000, 500]);
        } catch {}
      };
      triggerVibe();
      this.vibrateIntervalId = setInterval(triggerVibe, 3000);
    }
  }

  public stopRingtone() {
    this.isRinging = false;

    // Clear intervals
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.vibrateIntervalId) {
      clearInterval(this.vibrateIntervalId);
      this.vibrateIntervalId = null;
    }

    // Stop vibration
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(0);
      } catch {}
    }

    // Stop audio context
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }

    // Stop fallback audio
    if (this.fallbackAudio) {
      try {
        this.fallbackAudio.pause();
        this.fallbackAudio.currentTime = 0;
      } catch {}
    }
  }
}

export const ringtoneManager = new RingtoneManager();
