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
 */
export function Clock({ clock, team, sideToMove, serverClockOffsetMs, active }: ClockProps) {
  const [remaining, setRemaining] = useState(() =>
    remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs),
  );

  useEffect(() => {
    let frame: number;
    const tick = () => {
      setRemaining(remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, team, sideToMove, serverClockOffsetMs]);

  const low = active && remaining <= 10_000;

  return (
    <span
      data-testid={`clock-${team.toLowerCase()}`}
      className={`rounded px-3 py-1 font-mono text-lg tabular-nums ${
        active ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300'
      } ${low ? 'text-red-400' : ''}`}
    >
      {formatRemaining(remaining)}
    </span>
  );
}
