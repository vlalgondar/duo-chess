import { useEffect, useState } from 'react';
import { remainingMs, type ClockState, type Team } from '@duo/shared';

interface ClockProps {
  clock: ClockState;
  team: Team;
  sideToMove: Team;
  /** `serverNow - Date.now()` from the last `clock_sync` — see `store.ts`'s doc comment. */
  serverClockOffsetMs: number;
  active: boolean;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * §8.6: "Client runs `requestAnimationFrame`, subtracts elapsed local time
 * from the last `clock_sync`, and corrects toward the server value smoothly
 * rather than snapping." Reuses `remainingMs` (the same pure function the
 * server's own alarm scheduling is built on, `clock.ts`) so the countdown
 * and the server's flag-fall deadline can never silently disagree on the
 * arithmetic.
 *
 * §5.10/§9: "handle `visibilitychange`: when the tab is backgrounded, keep
 * the socket open but stop the animation loop." The loop stops entirely
 * (not just skips a `setRemaining`) while `document.hidden`, and restarts
 * immediately on return — by then `App.tsx`'s own `visibilitychange`
 * listener has already re-sent `join` to force a fresh `state`, so the very
 * first recomputed tick here is against up-to-date `clock`/`sideToMove`.
 */
export function Clock({ clock, team, sideToMove, serverClockOffsetMs, active }: ClockProps) {
  const [remaining, setRemaining] = useState(() =>
    remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs),
  );

  useEffect(() => {
    let frame: number | null = null;

    const tick = () => {
      setRemaining(remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs));
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame === null && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const handleVisibilityChange = () => (document.visibilityState === 'visible' ? start() : stop());

    document.addEventListener('visibilitychange', handleVisibilityChange);
    start();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stop();
    };
  }, [clock, team, sideToMove, serverClockOffsetMs]);

  const low = active && remaining <= 10_000;

  return (
    <span
      data-testid={`clock-${team.toLowerCase()}`}
      className={`rounded-lg border-2 px-4 py-1.5 font-mono text-xl font-semibold tabular-nums transition-colors ${
        active ? 'border-accent bg-surface-2 text-text' : 'border-transparent bg-surface-2 text-text-muted'
      } ${low ? 'text-danger-hi' : ''}`}
    >
      {formatRemaining(remaining)}
      {/* Test-only accessor (same spirit as `Board`'s `data-testid="fen"`) — `formatRemaining`
          rounds to the second, too coarse to assert the visibilitychange resync's 250ms budget. */}
      <span data-testid={`clock-ms-${team.toLowerCase()}`} className="sr-only">
        {remaining}
      </span>
    </span>
  );
}
