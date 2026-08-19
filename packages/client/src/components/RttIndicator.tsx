import { rttLevel } from '../rtt.js';

interface RttIndicatorProps {
  rttMs: number | null;
}

// §8 rule 10's green/yellow/red — a plain dot rather than a number, per the design's own framing
// ("is it lagging or is it Dave") as a glance-able status, not a stat readout.
const DOT_CLASS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

/** §8 rule 10: "RTT indicator in the corner." Renders nothing until the first `pong` arrives. */
export function RttIndicator({ rttMs }: RttIndicatorProps) {
  if (rttMs === null) return null;
  const level = rttLevel(rttMs);
  return (
    <span
      data-testid="rtt-indicator"
      data-level={level}
      title={`${rttMs}ms`}
      className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASS[level]}`}
    />
  );
}
