/**
 * Gentle dependency-free Web Audio chime for incoming live-chat messages.
 * Silently no-ops if AudioContext is blocked before user gesture.
 */
let audioCtx: AudioContext | null = null;

export function playChatChime(variant: 'visitor' | 'operator' = 'visitor'): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';

    if (variant === 'operator') {
      // Soft two-note ascending chime for staff inbox
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.09); // A5
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.27);
    } else {
      // Subtle single warm ping for customer widget
      osc.frequency.setValueAtTime(659.25, now); // E5
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    }
  } catch {
    // ignore audio errors
  }
}
