/**
 * Pure clock arithmetic, per docs/DESIGN.md §4.6 and §4.1's "Timeout" row.
 *
 * One clock per team. `ClockState` stores each team's `remainingMs` plus
 * `turnStartedAt`/`running` for whichever team currently has the clock ticking
 * against them (always `sideToMove` — see `gameEngine.commitMove`, the only
 * caller of `advanceClock`). No `Date.now()` (rule 1): every function here
 * takes `now` as a parameter.
 */
import { Chess } from 'chess.js';
import type { ClockState, GameStatus, Team, TimeControl } from './types.js';

/** `baseMs: 0` is §4.6's "Unlimited" — no clock at all, not a zero-time clock. */
function isUnlimited(timeControl: TimeControl): boolean {
  return timeControl.baseMs === 0;
}

/** Idle until White's first commit (§4.6): not running, no `turnStartedAt` yet. */
export function startClock(timeControl: TimeControl): ClockState {
  return {
    whiteMs: timeControl.baseMs,
    blackMs: timeControl.baseMs,
    turnStartedAt: null,
    running: false,
  };
}

/**
 * Applies one team's commit to the clock: deducts the time `mover` actually
 * spent since their clock started running, credits `timeControl.incrementMs`
 * (Fischer-style, added unconditionally — including a team's very first
 * move), then starts the clock running for the opponent from `now`.
 *
 * `mover`'s elapsed time is `now - turnStartedAt` only if the clock was
 * already running for them — on White's first commit `running` is still
 * `false` (set by `startClock`), so elapsed is 0 and White's own pre-move
 * thinking is free, per §4.6's "idle until White's first commit."
 *
 * Unlimited mode (`timeControl.baseMs === 0`) is a no-op: the clock never
 * starts, matching §4.6's "Unlimited | ∞ | — | No clock."
 */
export function advanceClock(clock: ClockState, mover: Team, now: number, timeControl: TimeControl): ClockState {
  if (isUnlimited(timeControl)) return clock;

  const elapsed = clock.running && clock.turnStartedAt !== null ? now - clock.turnStartedAt : 0;
  const moverStored = mover === 'WHITE' ? clock.whiteMs : clock.blackMs;
  const moverRemaining = Math.max(0, moverStored - elapsed) + timeControl.incrementMs;

  return {
    whiteMs: mover === 'WHITE' ? moverRemaining : clock.whiteMs,
    blackMs: mover === 'BLACK' ? moverRemaining : clock.blackMs,
    turnStartedAt: now,
    running: true,
  };
}

/**
 * `team`'s live remaining time at `now`, accounting for an in-progress tick
 * against `sideToMove` (the only team the clock ever runs against). Floored
 * at 0 — never negative. For any team but the one currently on the clock,
 * or before the clock has started, this is just the stored value.
 */
export function remainingMs(clock: ClockState, team: Team, sideToMove: Team, now: number): number {
  const stored = team === 'WHITE' ? clock.whiteMs : clock.blackMs;
  if (!clock.running || team !== sideToMove || clock.turnStartedAt === null) return stored;
  return Math.max(0, stored - (now - clock.turnStartedAt));
}

/**
 * Whether `team`'s clock has hit zero at `now`. Always `false` in unlimited
 * mode (§4.6) — without this guard `remainingMs` would read 0 for a clock
 * that was never meant to run at all, since `startClock` sets `baseMs: 0`
 * as the stored value.
 */
export function isFlagged(clock: ClockState, team: Team, sideToMove: Team, now: number, timeControl: TimeControl): boolean {
  if (isUnlimited(timeControl)) return false;
  return remainingMs(clock, team, sideToMove, now) <= 0;
}

/**
 * Resolves a flag-fall (§4.1 "Timeout" row): loss for `flaggedTeam` unless
 * the opponent has insufficient mating material, in which case it's a draw.
 * `chess.isInsufficientMaterial()` is a whole-board check, which is exactly
 * right here — if the position overall can't be forced to checkmate, the
 * flagged team's own material can't have been what was missing.
 */
export function resolveTimeout(fen: string, flaggedTeam: Team): { status: GameStatus; winner: Team | null } {
  if (new Chess(fen).isInsufficientMaterial()) return { status: 'DRAW', winner: null };
  return { status: 'TIMEOUT', winner: flaggedTeam === 'WHITE' ? 'BLACK' : 'WHITE' };
}
