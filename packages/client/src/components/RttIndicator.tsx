import { rttLevel } from '../rtt.js';
import { useRoomStore } from '../store.js';

// §8 rule 10's green/yellow/red — a plain dot rather than a number, per the design's own framing
// ("is it lagging or is it Dave") as a glance-able status, not a stat readout.
const DOT_CLASS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-primary',
  yellow: 'bg-accent',
  red: 'bg-danger-hi',
};

/**
 * §8 rule 10: "RTT indicator in the corner." Renders nothing until the first `pong` arrives.
 * Owns its own `fixed` corner placement — this used to be a `<div className="fixed right-3
 * top-3 z-50">` wrapper duplicated verbatim at three call sites in `App.tsx`.
 *
 * Reads `rttMs` from the store itself rather than taking it as a prop (as it used to) — a
 * `pong` arrives every `PING_INTERVAL_MS` (4s) and used to re-render `App`'s entire tree just to
 * update this one dot. Subscribing here means only this component re-renders on that tick.
 */
export function RttIndicator() {
  const rttMs = useRoomStore((s) => s.rttMs);
  if (rttMs === null) return null;
  const level = rttLevel(rttMs);
  return (
    <div className="fixed right-3 top-3 z-50">
      <span
        data-testid="rtt-indicator"
        data-level={level}
        title={`${rttMs}ms`}
        className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASS[level]}`}
      />
    </div>
  );
}
