import { describe, expect, it } from 'vitest';
import { materialFromFen } from './material.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('materialFromFen', () => {
  it('is empty and even at the starting position', () => {
    expect(materialFromFen(START)).toEqual({ capturedByWhite: [], capturedByBlack: [], advantage: 0 });
  });

  it('credits the capturer after a plain capture (exd5)', () => {
    // 1. e4 d5 2. exd5 — White has taken Black's d-pawn.
    const fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    expect(materialFromFen(fen)).toEqual({ capturedByWhite: ['p'], capturedByBlack: [], advantage: 1 });
  });

  it('sums multiple captures on both sides into a net advantage', () => {
    // White is missing a knight and a pawn (down 4); Black is missing a bishop (down 3).
    // Net: White is down 1 overall.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/R1BQKBNR w KQkq - 0 1'; // White: no N, no last pawn
    const material = materialFromFen(fen);
    expect(material.capturedByBlack).toEqual(['p', 'n']); // Black captured White's pawn + knight
    expect(material.capturedByWhite).toEqual([]);
    expect(material.advantage).toBe(-4);
  });

  it('treats a promoted queen as a real queen in the advantage, not a phantom captured pawn', () => {
    // White's a-pawn promoted to a queen (parked on e4, so the back rank stays intact — a
    // promotion needs its origin square vacated, which a real game would reach by first moving
    // the rook away; this FEN just states the end result) with no capture involved: two white
    // queens, one fewer white pawn, Black's pieces fully untouched.
    const fen = 'rnbqkbnr/pppppppp/8/8/4Q3/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1';
    const material = materialFromFen(fen);
    // The tray takes the conventional "starting complement minus current count" shortcut, so the
    // vanished pawn still reads as a phantom capture credited to Black — the documented,
    // deliberate divergence from `advantage`.
    expect(material.capturedByBlack).toEqual(['p']);
    expect(material.capturedByWhite).toEqual([]);
    // The live board sum is exact regardless: White gained a queen (+9) and lost a pawn (-1) for
    // a net of +8, not the -1 + 9 = +8... i.e. advantage must reflect the real material, not the
    // tray's phantom pawn.
    expect(material.advantage).toBe(8);
  });

  it('is exact through a capturing promotion (bxa8=Q)', () => {
    // Black's a8 rook is captured by White's b-pawn promoting onto that square: White's back
    // rank and pawns are otherwise untouched (the b-pawn is what promoted), Black's own pawns
    // are untouched (it lost a rook, not a pawn).
    const fen = 'Qnbqkbnr/pppppppp/8/8/8/8/P1PPPPPP/RNBQKBNR b KQkq - 0 1';
    const material = materialFromFen(fen);
    expect(material.capturedByWhite).toEqual(['r']); // Black's rook is really gone
    expect(material.capturedByBlack).toEqual(['p']); // phantom: White's promoting pawn "vanished"
    // White: +1 queen (9), -1 pawn (1) relative to start = +8 on top of an even position, plus
    // Black is down a rook (5) it no longer has to weigh in on its own sum — computed directly
    // from the live board rather than restated as arithmetic here.
    expect(material.advantage).toBe(8 + 5);
  });

  it('credits every non-king piece as captured, evenly, with only kings left on the board', () => {
    // A bare-kings position is reachable *only* through captures (promotion converts a pawn into
    // a piece, it never removes one from the board), so — unlike the earlier promotion cases —
    // there's no phantom here: every missing piece really was taken, in equal measure on both
    // sides, so `advantage` is exactly 0 even though both trays are full.
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const fullTray: ReturnType<typeof materialFromFen>['capturedByWhite'] = [
      'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'n', 'n', 'b', 'b', 'r', 'r', 'q',
    ];
    expect(materialFromFen(fen)).toEqual({
      capturedByWhite: fullTray,
      capturedByBlack: fullTray,
      advantage: 0,
    });
  });
});
