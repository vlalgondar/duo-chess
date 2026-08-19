import { describe, expect, it } from 'vitest';
import { advanceClock, flagFallDeadline, isFlagged, remainingMs, resolveTimeout, startClock } from './clock.js';
import type { ClockState, TimeControl } from './types.js';

const TIME_CONTROL: TimeControl = { baseMs: 600_000, incrementMs: 5_000, label: '10+5' };
const NO_INCREMENT: TimeControl = { baseMs: 60_000, incrementMs: 0, label: '1+0' };
const UNLIMITED: TimeControl = { baseMs: 0, incrementMs: 0, label: 'Unlimited' };
const NOW = 1_000_000;

describe('startClock', () => {
  it('is idle until White\'s first commit', () => {
    expect(startClock(TIME_CONTROL)).toEqual({
      whiteMs: 600_000,
      blackMs: 600_000,
      turnStartedAt: null,
      running: false,
    });
  });
});

describe('advanceClock', () => {
  it('deducts nothing on the idle clock (White\'s first commit is free thinking time)', () => {
    const clock = startClock(TIME_CONTROL);
    const result = advanceClock(clock, 'WHITE', NOW + 45_000, TIME_CONTROL);
    expect(result).toEqual({
      whiteMs: TIME_CONTROL.baseMs + TIME_CONTROL.incrementMs,
      blackMs: TIME_CONTROL.baseMs,
      turnStartedAt: NOW + 45_000,
      running: true,
    });
  });

  it('deducts elapsed time from the running side and starts the opponent ticking', () => {
    const clock: ClockState = { whiteMs: 600_000, blackMs: 55_000, turnStartedAt: NOW, running: true };
    const result = advanceClock(clock, 'BLACK', NOW + 12_000, TIME_CONTROL);
    expect(result).toEqual({
      whiteMs: 600_000,
      blackMs: 55_000 - 12_000 + TIME_CONTROL.incrementMs,
      turnStartedAt: NOW + 12_000,
      running: true,
    });
  });

  it('floors exactly to zero rather than going negative at the boundary', () => {
    const clock: ClockState = { whiteMs: 10_000, blackMs: 60_000, turnStartedAt: NOW, running: true };
    const result = advanceClock(clock, 'WHITE', NOW + 10_000, NO_INCREMENT);
    expect(result.whiteMs).toBe(0);
  });

  it('applies the increment even when elapsed exceeds remaining time', () => {
    const clock: ClockState = { whiteMs: 1_000, blackMs: 60_000, turnStartedAt: NOW, running: true };
    const result = advanceClock(clock, 'WHITE', NOW + 5_000, TIME_CONTROL);
    expect(result.whiteMs).toBe(TIME_CONTROL.incrementMs);
  });

  it('never advances in unlimited mode', () => {
    const clock = startClock(UNLIMITED);
    const result = advanceClock(clock, 'WHITE', NOW + 3_600_000, UNLIMITED);
    expect(result).toEqual(clock);
  });
});

describe('remainingMs / isFlagged', () => {
  it.each([
    ['idle clock, not yet running', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: null, running: false } as ClockState, 'WHITE', 'WHITE', NOW + 999_999, 60_000, false],
    ['team on the clock, mid-turn', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', 'WHITE', NOW + 30_000, 30_000, false],
    ['1ms above the boundary is not yet flagged', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', 'WHITE', NOW + 59_999, 1, false],
    ['exact zero is flagged', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', 'WHITE', NOW + 60_000, 0, true],
    ['past zero clamps to zero and stays flagged', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', 'WHITE', NOW + 90_000, 0, true],
    ['the team not on the clock is unaffected', { whiteMs: 0, blackMs: 60_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', 'BLACK', NOW + 90_000, 0, true],
  ] as const)('%s', (_label, clock, team, sideToMove, now, expectedRemaining, expectedFlagged) => {
    expect(remainingMs(clock, team, sideToMove, now)).toBe(expectedRemaining);
    expect(isFlagged(clock, team, sideToMove, now, TIME_CONTROL)).toBe(expectedFlagged);
  });

  it('never reports flagged in unlimited mode, even at zero remaining', () => {
    const clock = startClock(UNLIMITED);
    expect(remainingMs(clock, 'WHITE', 'WHITE', NOW + 3_600_000)).toBe(0);
    expect(isFlagged(clock, 'WHITE', 'WHITE', NOW + 3_600_000, UNLIMITED)).toBe(false);
  });
});

describe('flagFallDeadline', () => {
  it.each([
    ['running clock: deadline is turnStartedAt + the mover\'s stored remaining time', { whiteMs: 60_000, blackMs: 90_000, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', TIME_CONTROL, NOW + 60_000],
    ['idle clock (not yet running)', { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: null, running: false } as ClockState, 'WHITE', TIME_CONTROL, null],
    ['unlimited mode never has a deadline, even if somehow marked running', { whiteMs: 0, blackMs: 0, turnStartedAt: NOW, running: true } as ClockState, 'WHITE', UNLIMITED, null],
  ] as const)('%s', (_label, clock, sideToMove, timeControl, expected) => {
    expect(flagFallDeadline(clock, sideToMove, timeControl)).toBe(expected);
  });
});

describe('resolveTimeout', () => {
  const FULL_MATERIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const BARE_KINGS_FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

  it('is a loss for the flagged team when the opponent can still mate', () => {
    expect(resolveTimeout(FULL_MATERIAL_FEN, 'WHITE')).toEqual({ status: 'TIMEOUT', winner: 'BLACK' });
    expect(resolveTimeout(FULL_MATERIAL_FEN, 'BLACK')).toEqual({ status: 'TIMEOUT', winner: 'WHITE' });
  });

  it('is a draw when the opponent has insufficient mating material', () => {
    expect(resolveTimeout(BARE_KINGS_FEN, 'WHITE')).toEqual({ status: 'DRAW', winner: null });
  });
});
