export type RttLevel = 'green' | 'yellow' | 'red';

/**
 * §8 rule 10: "RTT indicator in the corner (green/yellow/red)... so 'is it
 * lagging or is it Dave' has an answer." Thresholds anchored on the
 * §8 target itself ("click -> other players see it in under 150ms").
 */
export function rttLevel(ms: number): RttLevel {
  if (ms <= 150) return 'green';
  if (ms <= 400) return 'yellow';
  return 'red';
}
