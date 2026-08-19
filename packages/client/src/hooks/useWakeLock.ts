import { useEffect } from 'react';

/**
 * §5.10: "Wake lock (`navigator.wakeLock`) during an active game, so the
 * screen doesn't sleep while your teammate thinks." Feature-detected —
 * unsupported browsers (notably older Safari) just get no lock, never a
 * crash. The spec auto-releases a lock when the document goes hidden, so
 * this re-requests on every `visibilitychange` back to visible while still
 * `active`, not just once on mount.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = () => {
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            void sentinel.release();
            return;
          }
          lock = sentinel;
        })
        .catch(() => {
          // Denied, or the page lost focus before the request resolved — a lost lock is a
          // nicety missed, never worth surfacing as an error.
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && lock === null) request();
    };

    request();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}
