import type { MaterialPiece } from '../material.js';
import { GHOST_GLYPHS } from './Board.js';

interface CapturedTrayProps {
  /** This side's captured pieces, smallest-to-largest (`material.ts`'s `capturedByWhite`/`capturedByBlack`). */
  pieces: readonly MaterialPiece[];
  /** The color of the captured pieces themselves — i.e. the opponent's color — drives the glyph tint. */
  capturedColor: 'w' | 'b';
  /** Already resolved for this side: pass a positive value only when this side is ahead. Omitted/0/negative renders nothing. */
  advantage?: number;
}

// Both trays use the filled glyph set (`GHOST_GLYPHS.b`) rather than switching glyph shape by
// color — `Board.tsx`'s outline `w` set reads as near-invisible against this dark theme, a
// problem the proposal ghost piece doesn't hit since it's always drawn in the proposing team's
// bright accent color, not this tray's more muted tint. A fixed shape plus a color swap is what
// actually differentiates "a captured white pawn" from "a captured black pawn" here.
const TINT: Record<'w' | 'b', string> = { w: '#EBE3D2', b: '#8b93a8' };

const PIECE_NAME: Record<MaterialPiece, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
};

function summarize(pieces: readonly MaterialPiece[]): string {
  if (pieces.length === 0) return 'No pieces captured';
  const counts = new Map<MaterialPiece, number>();
  for (const piece of pieces) counts.set(piece, (counts.get(piece) ?? 0) + 1);
  return `Captured: ${[...counts.entries()].map(([piece, n]) => `${n} ${PIECE_NAME[piece]}${n > 1 ? 's' : ''}`).join(', ')}`;
}

/**
 * Post-ship feature (not in the original `docs/DESIGN.md` scope — see §5.5/§5.10 for where it's
 * now documented): the pieces a side has taken, plus its point differential when ahead. Lives
 * inside `GameScreen`'s existing name/clock rows rather than a row of its own, so it adds no
 * height and the hand-tallied board-sizing chrome budgets don't move.
 */
export function CapturedTray({ pieces, capturedColor, advantage }: CapturedTrayProps) {
  if (pieces.length === 0 && !advantage) return null;

  return (
    <span
      data-testid={`captured-tray-${capturedColor}`}
      aria-label={summarize(pieces)}
      className="flex items-center leading-none"
    >
      <span className="flex text-lg" style={{ color: TINT[capturedColor] }} aria-hidden="true">
        {pieces.map((piece, i) => (
          <span key={`${piece}-${i}`} style={i === 0 ? undefined : { marginLeft: '-0.4em' }}>
            {GHOST_GLYPHS.b[piece]}
          </span>
        ))}
      </span>
      {!!advantage && advantage > 0 && (
        <span
          data-testid={`material-advantage-${capturedColor}`}
          className="ml-1 text-xs font-semibold text-text-dim"
        >
          +{advantage}
        </span>
      )}
    </span>
  );
}
