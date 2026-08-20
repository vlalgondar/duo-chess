import { describe, expect, it } from 'vitest';
import { diffFen } from './boardDiff.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('diffFen', () => {
  it('reports the mover for a quiet move', () => {
    // 1. e4
    const next = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(diffFen(START, next)).toEqual({ move: { from: 'e2', to: 'e4' }, vanished: {} });
  });

  it('marks the victim as vanished on a plain capture', () => {
    // ...exd5 after 1. e4 d5 2. Nc3 Nf6 3. exd5? just isolate the capture step directly.
    const before = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
    const after = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e4', to: 'd5' }, vanished: { d5: 'b' } });
  });

  it('marks the captured pawn square as vanished on en passant', () => {
    const before = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    const after = 'rnbqkbnr/ppp1pppp/3P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e5', to: 'd6' }, vanished: { d5: 'b' } });
  });

  it('reports the king from/to for white kingside castling, with no vanished pieces', () => {
    const before = 'rnbqk2r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const after = 'rnbqk2r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e1', to: 'g1' }, vanished: {} });
  });

  it('reports the king from/to for black queenside castling, with no vanished pieces', () => {
    const before = 'r3kbnr/pppqpppp/2np4/8/8/2NP4/PPPQPPPP/R3KBNR b KQkq - 6 5';
    const after = '2kr1bnr/pppqpppp/2np4/8/8/2NP4/PPPQPPPP/R3KBNR w KQ - 7 6';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e8', to: 'c8' }, vanished: {} });
  });

  it('reports the pawn from/to and marks its own square vanished on a quiet promotion', () => {
    const before = '8/4P1k1/8/8/8/8/6K1/8 w - - 0 1';
    const after = '4Q3/6k1/8/8/8/8/6K1/8 b - - 0 1';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e7', to: 'e8' }, vanished: {} });
  });

  it('marks the captured piece vanished on a capturing promotion', () => {
    const before = '3r4/4P1k1/8/8/8/8/6K1/8 w - - 0 1';
    const after = '3Q4/6k1/8/8/8/8/6K1/8 b - - 0 1';
    expect(diffFen(before, after)).toEqual({ move: { from: 'e7', to: 'd8' }, vanished: { d8: 'b' } });
  });

  it('returns an empty diff for an unrelated position jump', () => {
    const rematch = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const midGame = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(diffFen(midGame, rematch)).toEqual({ move: null, vanished: {} });
  });
});
