/**
 * Captured-piece tray + point differential (post-ship feature, not in `docs/DESIGN.md`'s
 * original scope — see §5.5/§5.10 for where it's now documented). Nothing new goes over the
 * wire: `PublicGameState.moveHistory` is SAN-only and `move_committed` carries no captured-piece
 * info, and changing the wire protocol is a halt-and-ask item per `TASKS.md` — so this is derived
 * entirely client-side from the live FEN, same spirit as `boardDiff.ts`'s FEN-only derivations.
 */

export type MaterialPiece = 'p' | 'n' | 'b' | 'r' | 'q';

/** Standard chess values, kings excluded (a king can never be captured). */
const PIECE_VALUE: Record<MaterialPiece, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Smallest-to-largest — the conventional tray ordering (pawns first, then climbing in value). */
const PIECE_ORDER: readonly MaterialPiece[] = ['p', 'n', 'b', 'r', 'q'];

/** Each side's starting complement of non-king pieces. */
const STARTING_COUNT: Record<MaterialPiece, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

export interface Material {
  /** Black pieces missing from the board (smallest-to-largest) — what White has taken. */
  capturedByWhite: MaterialPiece[];
  /** White pieces missing from the board (smallest-to-largest) — what Black has taken. */
  capturedByBlack: MaterialPiece[];
  /** Live board material sum, White minus Black (kings excluded). Positive: White is ahead. */
  advantage: number;
}

type Counts = Record<MaterialPiece, number>;

function emptyCounts(): Counts {
  return { p: 0, n: 0, b: 0, r: 0, q: 0 };
}

/**
 * Tallies each side's live piece counts from the FEN board field (the part before the first
 * space) — a single O(64) character scan, not a `chess.js` SAN replay. A replay is exact (it can
 * distinguish "captured" from "promoted away"), but costs O(moves) of move-application work on
 * every server snapshot, which is exactly the per-render cost `Board`'s memoization elsewhere is
 * removing. The one-character trade-off this makes is documented below.
 */
function countPieces(fen: string): { white: Counts; black: Counts } {
  const white = emptyCounts();
  const black = emptyCounts();
  const board = fen.split(' ')[0] ?? '';
  for (const char of board) {
    if (char === '/' || (char >= '1' && char <= '9')) continue;
    const lower = char.toLowerCase();
    if (lower === 'k') continue; // kings are never captured — irrelevant to material
    if (!(lower in white)) continue; // '/' rank separators, digits already skipped above
    const piece = lower as MaterialPiece;
    if (char === lower) black[piece] += 1;
    else white[piece] += 1;
  }
  return { white, black };
}

/**
 * `capturedByWhite`/`capturedByBlack` are each derived as "starting complement minus current
 * count, clamped at zero" for the *opponent's* pieces — this is what every mainstream chess UI's
 * captured-piece tray shows, and it deliberately disagrees with `advantage` under promotion: a
 * pawn that promoted away (not captured) still reads as "missing" here, so it still shows up as
 * a phantom captured pawn in the tray. `advantage`, by contrast, sums the *live* board (a
 * promoted queen counts as a queen, not a phantom-adjusted pawn), so it stays exactly correct
 * through promotions even while the tray takes the conventional cosmetic shortcut.
 */
export function materialFromFen(fen: string): Material {
  const { white, black } = countPieces(fen);

  const capturedByWhite: MaterialPiece[] = [];
  const capturedByBlack: MaterialPiece[] = [];
  let whiteSum = 0;
  let blackSum = 0;

  for (const piece of PIECE_ORDER) {
    const missingBlack = Math.max(0, STARTING_COUNT[piece] - black[piece]);
    const missingWhite = Math.max(0, STARTING_COUNT[piece] - white[piece]);
    for (let i = 0; i < missingBlack; i++) capturedByWhite.push(piece);
    for (let i = 0; i < missingWhite; i++) capturedByBlack.push(piece);
    whiteSum += white[piece] * PIECE_VALUE[piece];
    blackSum += black[piece] * PIECE_VALUE[piece];
  }

  return { capturedByWhite, capturedByBlack, advantage: whiteSum - blackSum };
}
