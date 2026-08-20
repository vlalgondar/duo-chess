import { rttLevel } from '../rtt.js';

interface RttIndicatorProps {
  rttMs: number | null;
}

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
 */
export function RttIndicator({ rttMs }: RttIndicatorProps) {
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
