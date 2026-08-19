/**
 * Authoritative move engine, per docs/DESIGN.md §4.1.
 *
 * "`chess.js` covers all of the following; the spec is here so acceptance
 * testing has something to check against" — so this module is a thin,
 * pure wrapper: `chess.js` owns every legality rule (check, castling
 * conditions, en passant, promotion, draw detection), this module owns
 * turning that into `GameState` transitions. No I/O, no `Date.now()` (rule 1).
 *
 * Threefold repetition and the fifty-move rule depend on the *sequence* of
 * positions, not just the current FEN (the FEN's halfmove clock alone isn't
 * enough for repetition), so every check replays `moveHistory` (SAN) from
 * the start position through a fresh `chess.js` instance rather than trusting
 * `fen` in isolation.
 */
import { Chess } from 'chess.js';
import type { ErrorCode, GameState, GameStatus, PromotionPiece, Square, Team, TimeControl } from './types.js';

export type GameEngineResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

function ok<T>(value: T): GameEngineResult<T> {
  return { ok: true, value };
}

function fail<T>(code: ErrorCode): GameEngineResult<T> {
  return { ok: false, code };
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece | undefined;
}

export interface LegalMove extends MoveInput {
  san: string;
}

function replay(sanHistory: readonly string[], startFen?: string): Chess {
  const chess = startFen !== undefined ? new Chess(startFen) : new Chess();
  for (const san of sanHistory) {
    chess.move(san);
  }
  return chess;
}

function endStateOf(chess: Chess): { status: GameStatus; winner: Team | null } {
  if (chess.isCheckmate()) {
    return { status: 'CHECKMATE', winner: chess.turn() === 'w' ? 'BLACK' : 'WHITE' };
  }
  if (chess.isStalemate()) return { status: 'STALEMATE', winner: null };
  if (chess.isInsufficientMaterial()) return { status: 'DRAW', winner: null };
  if (chess.isThreefoldRepetition()) return { status: 'DRAW', winner: null };
  if (chess.isDrawByFiftyMoves()) return { status: 'DRAW', winner: null };
  return { status: 'ACTIVE', winner: null };
}

/**
 * Every legal move from `fen`, one entry per promotion choice (so a pawn
 * reaching the last rank contributes four entries) — the shape perft needs.
 */
export function legalMoves(fen: string): LegalMove[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).map((m) => ({
    from: m.from as Square,
    to: m.to as Square,
    promotion: m.promotion as PromotionPiece | undefined,
    san: m.san,
  }));
}

/**
 * Checkmate/stalemate/draw detection (§4.1) over the full SAN history.
 *
 * `startFen` is a test seam: real games always replay from the standard
 * starting position (the only one `startGame` ever produces), so production
 * callers omit it. It lets tests reach draw conditions — fifty-move,
 * insufficient material — that would otherwise need dozens of real moves to
 * set up, by seeding the position directly instead.
 */
export function checkGameEnd(
  sanHistory: readonly string[],
  startFen?: string,
): { status: GameStatus; winner: Team | null } {
  return endStateOf(replay(sanHistory, startFen));
}

export function startGame(timeControl: TimeControl): GameState {
  return {
    fen: new Chess().fen(),
    moveHistory: [],
    sideToMove: 'WHITE',
    proposals: { WHITE: null, BLACK: null },
    annotations: { WHITE: [], BLACK: [] },
    clock: {
      whiteMs: timeControl.baseMs,
      blackMs: timeControl.baseMs,
      turnStartedAt: null,
      running: false,
    },
    status: 'ACTIVE',
    winner: null,
    drawOffer: null,
    pendingVotes: [],
  };
}

/**
 * Applies one team's move to `game`. Legality — including check, castling
 * conditions, and en passant — is delegated entirely to `chess.js`, replayed
 * from `moveHistory` so repetition/fifty-move state is exact rather than
 * reconstructed from a single FEN. Clears both teams' proposals and
 * annotations (§4.3 rule 7: cleared on *every* commit, including the
 * opponent's) and re-derives `status`/`winner`.
 *
 * Clock advancement (increment on commit, flag-fall) is T-15/T-16's scope,
 * not this task's — `clock` passes through unchanged.
 *
 * `startFen` is the same test seam as `checkGameEnd`'s — production callers
 * always omit it, since `game.moveHistory` is only ever meaningful relative
 * to the standard start.
 */
export function commitMove(
  game: GameState,
  move: MoveInput,
  mover: Team,
  startFen?: string,
): GameEngineResult<GameState> {
  if (game.status !== 'ACTIVE') return fail('ILLEGAL_MOVE');
  if (mover !== game.sideToMove) return fail('NOT_YOUR_TURN');

  const chess = replay(game.moveHistory, startFen);
  let applied;
  try {
    applied =
      move.promotion !== undefined
        ? chess.move({ from: move.from, to: move.to, promotion: move.promotion })
        : chess.move({ from: move.from, to: move.to });
  } catch {
    return fail('ILLEGAL_MOVE');
  }

  const moveHistory = [...game.moveHistory, applied.san];
  const { status, winner } = endStateOf(chess);

  return ok({
    ...game,
    fen: chess.fen(),
    moveHistory,
    sideToMove: chess.turn() === 'w' ? 'WHITE' : 'BLACK',
    proposals: { WHITE: null, BLACK: null },
    annotations: { WHITE: [], BLACK: [] },
    status,
    winner,
  });
}
