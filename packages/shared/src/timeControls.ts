/**
 * Time control options, per docs/DESIGN.md §4.6's table. Canonical list
 * shared between the client's picker (T-16) and any future server-side
 * validation, rather than each maintaining its own copy.
 */
import type { TimeControl } from './types.js';

export const TIME_CONTROLS: readonly TimeControl[] = [
  { baseMs: 3 * 60_000, incrementMs: 2_000, label: 'Blitz 3+2' },
  { baseMs: 5 * 60_000, incrementMs: 0, label: 'Blitz 5+0' },
  { baseMs: 5 * 60_000, incrementMs: 3_000, label: 'Blitz 5+3' },
  { baseMs: 10 * 60_000, incrementMs: 0, label: 'Rapid 10+0' },
  { baseMs: 10 * 60_000, incrementMs: 5_000, label: 'Rapid 10+5' },
  { baseMs: 15 * 60_000, incrementMs: 0, label: 'Rapid 15+0' },
  { baseMs: 15 * 60_000, incrementMs: 10_000, label: 'Rapid 15+10' },
  { baseMs: 20 * 60_000, incrementMs: 0, label: 'Rapid 20+0' },
  { baseMs: 30 * 60_000, incrementMs: 0, label: 'Classical 30+0' },
  { baseMs: 30 * 60_000, incrementMs: 20_000, label: 'Classical 30+20' },
  { baseMs: 0, incrementMs: 0, label: 'Unlimited' },
];

/** §4.6: "I'd surface 10+5 and 15+10 as the featured options ... put the rest behind a 'more' expander." */
export const FEATURED_TIME_CONTROL_LABELS: readonly string[] = ['Rapid 10+5', 'Rapid 15+10'];

export const DEFAULT_TIME_CONTROL: TimeControl = TIME_CONTROLS.find((tc) => tc.label === 'Rapid 10+5')!;
