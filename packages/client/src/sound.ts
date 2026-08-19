const STORAGE_KEY = 'duo-chess:sound-enabled';

/**
 * T-27: "Sounds (mutable, default off on mobile)." Pure so it's testable
 * without a DOM — the call site passes in whatever it reads from
 * `window.matchMedia('(pointer: coarse)').matches`, the same touch-capability
 * signal `Board.tsx`'s hover-dots feature gates on.
 */
export function defaultSoundEnabled(hasCoarsePointer: boolean): boolean {
  return !hasCoarsePointer;
}

export function loadSoundEnabled(hasCoarsePointer: boolean): boolean {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return defaultSoundEnabled(hasCoarsePointer);
}

export function saveSoundEnabled(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

/** A short sine-wave beep — no audio asset dependency, just Web Audio oscillators. */
function playTone(frequencyHz: number, durationMs: number): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequencyHz;
    gain.gain.value = 0.15;
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Autoplay restrictions or an unsupported browser — sound is a nicety, never worth a crash.
  }
}

export function playMoveSound(capture: boolean): void {
  playTone(capture ? 320 : 440, 90);
}

export function playGameOverSound(): void {
  playTone(220, 300);
}
