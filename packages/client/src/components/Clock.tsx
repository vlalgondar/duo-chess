import { useEffect, useRef, useState } from 'react';
import { remainingMs, type ClockState, type Team } from '@duo/shared';
import { useRoomStore } from '../store.js';

interface ClockProps {
  clock: ClockState;
  team: Team;
  sideToMove: Team;
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
 * §8 rule 8 ("avoid React re-render storms ... keep the clock in a separate
 * component so a 60fps clock doesn't re-render 64 squares"): the rAF loop
 * writes the rendered text straight to the DOM via refs instead of calling
 * `setState` every frame — the visible `m:ss` only actually changes once a
 * second, so ~60 `setState`s/sec per clock (two clocks running at once) were
 * pure waste. React state is kept only for `low` (the ≤10s styling), which
 * changes at most once per game. `serverClockOffsetMs` is read from the store
 * directly (not a prop) so a 5s `clock_sync` re-renders only the two `Clock`
 * instances, not the whole tree.
 *
 * §5.10/§9: "handle `visibilitychange`: when the tab is backgrounded, keep
 * the socket open but stop the animation loop." The loop stops entirely
 * while `document.hidden`, and restarts immediately on return — by then
 * `App.tsx`'s own `visibilitychange` listener has already re-sent `join` to
 * force a fresh `state`, so the very first recomputed tick here is against
 * up-to-date `clock`/`sideToMove`.
 */
export function Clock({ clock, team, sideToMove, active }: ClockProps) {
  const serverClockOffsetMs = useRoomStore((s) => s.serverClockOffsetMs);
  const textRef = useRef<HTMLSpanElement>(null);
  const msRef = useRef<HTMLSpanElement>(null);

  // The rAF loop below is the *only* writer of this ref — rendering straight off `Date.now()` in
  // the JSX instead was a real bug: a render triggered by something the loop has nothing to do
  // with (e.g. a `clock_sync` arriving while the tab is backgrounded — the server keeps sending
  // it on schedule regardless of tab visibility) would recompute a fresh, still-ticking value
  // from the real clock, even though `stop()` had already halted the loop and the display is
  // supposed to be frozen. Reading this ref during render is the same "adjust state while
  // rendering" pattern `Board.tsx`'s own `gameRef`/`fenDiffRef` already use.
  const preciseMsRef = useRef<number>(remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs));
  const [low, setLow] = useState(() => active && preciseMsRef.current <= 10_000);

  // Primitive fields, not `clock` itself: every server snapshot rebuilds `clock` as a fresh
  // object even when nothing about *this* clock changed, which used to tear down and restart
  // the rAF loop (and its rAF-timing phase) on every `state` and every 5s `clock_sync`.
  const { whiteMs, blackMs, turnStartedAt, running } = clock;

  useEffect(() => {
    let frame: number | null = null;
    let wasLow = active && remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs) <= 10_000;
    setLow(wasLow);

    const tick = () => {
      const remaining = remainingMs(clock, team, sideToMove, Date.now() + serverClockOffsetMs);
      preciseMsRef.current = remaining;
      if (textRef.current) textRef.current.textContent = formatRemaining(remaining);
      if (msRef.current) msRef.current.textContent = String(remaining);
      const nowLow = active && remaining <= 10_000;
      if (nowLow !== wasLow) {
        wasLow = nowLow;
        setLow(nowLow);
      }
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
    // Deliberately primitive fields, not `clock` itself — see the comment above.
  }, [whiteMs, blackMs, turnStartedAt, running, team, sideToMove, active, serverClockOffsetMs]);

  return (
    <span
      data-testid={`clock-${team.toLowerCase()}`}
      className={`rounded-lg border-2 px-4 py-1.5 font-mono text-xl font-semibold tabular-nums transition-colors ${
        active ? 'border-accent bg-surface-2 text-text' : 'border-transparent bg-surface-2 text-text-muted'
      } ${low ? 'text-danger-hi' : ''}`}
    >
      <span ref={textRef}>{formatRemaining(preciseMsRef.current)}</span>
      {/* Test-only accessor (same spirit as `Board`'s `data-testid="fen"`) — `formatRemaining`
          rounds to the second, too coarse to assert the visibilitychange resync's 250ms budget. */}
      <span data-testid={`clock-ms-${team.toLowerCase()}`} className="sr-only" ref={msRef}>
        {preciseMsRef.current}
      </span>
    </span>
  );
}
