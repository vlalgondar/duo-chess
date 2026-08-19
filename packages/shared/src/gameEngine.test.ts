import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { checkGameEnd, commitMove, legalMoves, startGame } from './gameEngine.js';
import type { GameState, Square } from './types.js';

const TIME_CONTROL = { baseMs: 600_000, incrementMs: 5_000, label: '10+5' };
const NOW = 1_000;

/** Recursive node count via `legalMoves`, so perft exercises this module's own move generation. */
function perft(fen: string, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(fen);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    const chess = new Chess(fen);
    if (move.promotion !== undefined) {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    } else {
      chess.move({ from: move.from, to: move.to });
    }
    nodes += perft(chess.fen(), depth - 1);
  }
  return nodes;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE_FEN = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

describe('perft', () => {
  it.each([
    [START_FEN, 1, 20],
    [START_FEN, 2, 400],
    [START_FEN, 3, 8_902],
    [KIWIPETE_FEN, 1, 48],
    [KIWIPETE_FEN, 2, 2_039],
    [KIWIPETE_FEN, 3, 97_862],
  ])('%s depth %i => %i nodes', (fen, depth, expected) => {
    expect(perft(fen, depth)).toBe(expected);
  });
});

describe('castling', () => {
  it('refuses to castle through an attacked square', () => {
    // White king e1, rook h1, both castling-path squares (f1, g1) empty —
    // but a black rook on f8 attacks f1 down the open f-file, so O-O must
    // not appear even though nothing is physically blocking it.
    const fen = '4kr2/8/8/8/8/8/8/4K2R w K - 0 1';
    const moves = legalMoves(fen);
    expect(moves.some((m) => m.from === 'e1' && m.to === 'g1')).toBe(false);
  });
});

describe('en passant', () => {
  it('refuses an en passant capture that discovers check', () => {
    // White king a5, pawn d5; black rook h5, pawn c5 (just played c7-c5).
    // dxc6 e.p. would remove both the c5 and d5 pawns from rank 5 in one
    // move, opening the rank and exposing the white king to the rook.
    const fen = '4k3/8/8/K1pP3r/8/8/8/8 w - c6 0 1';
    const moves = legalMoves(fen);
    expect(moves.some((m) => m.from === 'd5' && m.to === 'c6')).toBe(false);
    // the plain, non-capturing push is still legal
    expect(moves.some((m) => m.from === 'd5' && m.to === 'd6')).toBe(true);
  });
});

describe('promotion with capture', () => {
  it('promotes and captures in the same move', () => {
    const startFen = 'n1n1k3/1P6/8/8/8/8/8/4K3 w - - 0 1';
    const game = startGame(TIME_CONTROL);
    const result = commitMove(game, { from: 'b7', to: 'a8', promotion: 'q' }, 'WHITE', NOW, TIME_CONTROL, startFen);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.moveHistory).toEqual(['bxa8=Q']);
    expect(result.value.fen).toContain('Q1n1k3');
  });
});

describe('checkGameEnd', () => {
  it('detects stalemate', () => {
    let game = startGame(TIME_CONTROL);
    // The shortest known forced stalemate: 19 plies, black to move with no
    // legal moves and not in check. (1.c4 h5 2.h4 a5 3.Qa4 Ra6 4.Qxa5 Rah6
    // 5.Qxc7 f6 6.Qxd7+ Kf7 7.Qxb7 Qd3 8.Qxb8 Qh7 9.Qxc8 Kg6 10.Qe6)
    const moves: Array<[Square, Square]> = [
      ['c2', 'c4'],
      ['h7', 'h5'],
      ['h2', 'h4'],
      ['a7', 'a5'],
      ['d1', 'a4'],
      ['a8', 'a6'],
      ['a4', 'a5'],
      ['a6', 'h6'],
      ['a5', 'c7'],
      ['f7', 'f6'],
      ['c7', 'd7'],
      ['e8', 'f7'],
      ['d7', 'b7'],
      ['d8', 'd3'],
      ['b7', 'b8'],
      ['d3', 'h7'],
      ['b8', 'c8'],
      ['f7', 'g6'],
      ['c8', 'e6'],
    ];
    for (const [from, to] of moves) {
      const mover = game.sideToMove;
      const result = commitMove(game, { from, to }, mover, NOW, TIME_CONTROL);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('setup move rejected');
      game = result.value;
    }
    expect(checkGameEnd(game.moveHistory)).toEqual({ status: 'STALEMATE', winner: null });
  });

  // Rooks (not bare kings) so insufficient material never confounds the
  // halfmove-clock boundary being tested here.
  it('auto-draws at the fifty-move mark', () => {
    const fen = 'r3k3/8/8/8/8/8/8/R3K3 w - - 99 60';
    expect(checkGameEnd(['Kd1'], fen)).toEqual({ status: 'DRAW', winner: null });
  });

  it('does not draw one half-move before the fifty-move mark', () => {
    const fen = 'r3k3/8/8/8/8/8/8/R3K3 w - - 98 60';
    expect(checkGameEnd(['Kd1'], fen)).toEqual({ status: 'ACTIVE', winner: null });
  });

  it('auto-draws on threefold repetition', () => {
    let game = startGame(TIME_CONTROL);
    const shuffle: Array<[Square, Square]> = [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
    ];
    for (const [from, to] of shuffle) {
      const mover = game.sideToMove;
      const result = commitMove(game, { from, to }, mover, NOW, TIME_CONTROL);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('setup move rejected');
      game = result.value;
    }
    expect(checkGameEnd(game.moveHistory)).toEqual({ status: 'DRAW', winner: null });
  });

  it('treats K+B vs K as insufficient material', () => {
    const fen = '4k3/8/8/8/8/8/3B4/4K3 w - - 0 1';
    expect(checkGameEnd([], fen)).toEqual({ status: 'DRAW', winner: null });
  });
});

describe('commitMove', () => {
  it('rejects a move once the game has ended', () => {
    const stalemated: GameState = { ...startGame(TIME_CONTROL), status: 'STALEMATE' };
    const result = commitMove(stalemated, { from: 'e2', to: 'e4' }, 'WHITE', NOW, TIME_CONTROL);
    expect(result).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
  });

  it('rejects a move made out of turn', () => {
    const game = startGame(TIME_CONTROL);
    const result = commitMove(game, { from: 'e7', to: 'e5' }, 'BLACK', NOW, TIME_CONTROL);
    expect(result).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('rejects an illegal move', () => {
    const game = startGame(TIME_CONTROL);
    const result = commitMove(game, { from: 'e2', to: 'e5' }, 'WHITE', NOW, TIME_CONTROL);
    expect(result).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
  });

  it('deducts elapsed time from the mover, credits the increment, and starts the opponent ticking', () => {
    const game = startGame(TIME_CONTROL);
    const elapsed = 12_345;
    const result = commitMove(game, { from: 'e2', to: 'e4' }, 'WHITE', NOW + elapsed, TIME_CONTROL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // White's clock wasn't running yet (idle until White's first commit), so
    // none of `elapsed` is deducted — only the increment applies.
    expect(result.value.clock).toEqual({
      whiteMs: TIME_CONTROL.baseMs + TIME_CONTROL.incrementMs,
      blackMs: TIME_CONTROL.baseMs,
      turnStartedAt: NOW + elapsed,
      running: true,
    });
  });

  it('stops the clock once a move ends the game', () => {
    // Fool's Mate: the fastest possible checkmate, so the clock shouldn't
    // keep running for black's now-nonexistent next turn.
    const moves: Array<[Square, Square]> = [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
    ];
    let game = startGame(TIME_CONTROL);
    let now = NOW;
    for (const [from, to] of moves) {
      const mover = game.sideToMove;
      const result = commitMove(game, { from, to }, mover, now, TIME_CONTROL);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('setup move rejected');
      game = result.value;
      now += 1_000;
    }
    const result = commitMove(game, { from: 'd8', to: 'h4' }, 'BLACK', now, TIME_CONTROL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('CHECKMATE');
    expect(result.value.clock.running).toBe(false);
  });

  it('never advances the clock in unlimited mode', () => {
    const unlimited = { baseMs: 0, incrementMs: 0, label: 'Unlimited' };
    const game = startGame(unlimited);
    const result = commitMove(game, { from: 'e2', to: 'e4' }, 'WHITE', NOW + 60_000, unlimited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clock).toEqual({ whiteMs: 0, blackMs: 0, turnStartedAt: null, running: false });
  });
});
