import type { Square } from 'chess.js';

export type PieceColor = 'w' | 'b';

/** `<color><TYPE>` — the same encoding `react-chessboard` puts in a piece's `data-piece` attribute. */
type PieceCode = `${PieceColor}${'P' | 'N' | 'B' | 'R' | 'Q' | 'K'}`;

export interface FenDiff {
  /** from/to of the piece that moved — the king's squares for a castle. Null if not a single move. */
  move: { from: Square; to: Square } | null;
  /**
   * Squares whose occupant left with no destination in the new position, keyed to that piece's
   * color: a capture victim, an en-passant pawn, or a pawn that promoted away. `react-chessboard`
   * only animates a piece with a matching destination, so these are exactly the ones it strands
   * on screen for the whole `animationDuration` — Board marks them with `data-vanished` so CSS
   * can fade them out instead.
   */
  vanished: Partial<Record<Square, PieceColor>>;
}

const EMPTY_DIFF: FenDiff = { move: null, vanished: {} };

/** Board field only (FEN's first space-separated part) → `{ e4: 'wP', ... }`. */
function parseBoard(fen: string): Partial<Record<Square, PieceCode>> {
  const board = fen.split(' ')[0] ?? '';
  const board_: Partial<Record<Square, PieceCode>> = {};
  const ranks = board.split('/');
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
    const rank = 8 - rankIndex; // FEN's first rank row is rank 8
    let file = 0; // 0-7, a=0
    for (const char of ranks[rankIndex] ?? '') {
      if (char >= '1' && char <= '8') {
        file += Number(char);
        continue;
      }
      const color: PieceColor = char === char.toUpperCase() ? 'w' : 'b';
      const type = char.toUpperCase() as PieceCode[1];
      const square = `${String.fromCharCode('a'.charCodeAt(0) + file)}${rank}` as Square;
      board_[square] = `${color}${type}` as PieceCode;
      file += 1;
    }
  }
  return board_;
}

/**
 * Pure diff between two board positions, used only to drive UI hints (the mover's from/to for
 * the last-move tint, and which squares strand a piece `react-chessboard` won't animate) —
 * never for legality, which stays server-authoritative per `docs/DESIGN.md` rule 2.
 */
export function diffFen(prevFen: string, nextFen: string): FenDiff {
  const prev = parseBoard(prevFen);
  const next = parseBoard(nextFen);

  const removed: Partial<Record<Square, PieceCode>> = {};
  const added: Partial<Record<Square, PieceCode>> = {};
  const allSquares = new Set<Square>([
    ...(Object.keys(prev) as Square[]),
    ...(Object.keys(next) as Square[]),
  ]);
  for (const square of allSquares) {
    const before = prev[square];
    const after = next[square];
    if (before === after) continue;
    if (before) removed[square] = before;
    if (after) added[square] = after;
  }

  const removedEntries = Object.entries(removed) as [Square, PieceCode][];
  const addedEntries = Object.entries(added) as [Square, PieceCode][];

  // No single legal move touches more than 4 squares (castling: king + rook, each removed and
  // added once). A bigger diff is a position jump (rematch, a fresh join's snapshot) — bail
  // before the matching logic below, which is only meant to disambiguate *within* one move and
  // can otherwise pair up unrelated pieces by coincidence of matching codes.
  if (removedEntries.length + addedEntries.length > 4) return EMPTY_DIFF;

  const vanished: Partial<Record<Square, PieceColor>> = {};
  let move: { from: Square; to: Square } | null = null;
  const unmatchedAdded = new Map(addedEntries);

  // A removed piece is the mover when the identical piece code reappears elsewhere — the common
  // case (quiet move, capture, en passant's non-capturing side) and one of castling's two movers
  // (rook and king both qualify; the king wins below since a capture/ep leaves only one mover).
  for (const [from, code] of removedEntries) {
    const to = addedEntries.find(([, addedCode]) => addedCode === code)?.[0];
    if (to !== undefined) {
      unmatchedAdded.delete(to);
      // Castling moves both king and rook — report the king's own from/to, not the rook's.
      if (move === null || code[1] === 'K') move = { from, to };
    } else {
      vanished[from] = code[0] as PieceColor;
    }
  }

  // Promotion: a removed pawn with no surviving pawn elsewhere, paired with a leftover added
  // non-pawn of the same color — `exd8=Q` diffs to a removed `wP`/`e7` and an added `wQ`/`d8`.
  const unresolvedRemoved = removedEntries.filter(([from]) => vanished[from] !== undefined);
  for (const [from, removedCode] of unresolvedRemoved) {
    if (removedCode[1] !== 'P') continue;
    const promoted = [...unmatchedAdded].find(([, code]) => code[0] === removedCode[0] && code[1] !== 'P');
    if (!promoted) continue;
    const [to] = promoted;
    unmatchedAdded.delete(to);
    delete vanished[from];
    move = { from, to };
  }

  // More than the mover(s) left unresolved means this isn't a single move (rematch, a fresh
  // join's snapshot) — bail rather than guess, so a position jump renders no stray fade/tint.
  if (unmatchedAdded.size > 0 || Object.keys(vanished).length > 1) return EMPTY_DIFF;

  return { move, vanished };
}
