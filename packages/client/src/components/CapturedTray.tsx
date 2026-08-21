import { groupCaptured, type MaterialPiece } from '../material.js';
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
  const runs = groupCaptured(pieces);
  return `Captured: ${runs.map(({ piece, count }) => `${count} ${PIECE_NAME[piece]}${count > 1 ? 's' : ''}`).join(', ')}`;
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
      className="flex shrink-0 items-center leading-none"
    >
      <span
        className="flex shrink-0 items-center gap-[0.2em] text-base"
        style={{ color: TINT[capturedColor] }}
        aria-hidden="true"
      >
        {groupCaptured(pieces).map(({ piece, count }) => (
          <span key={piece} className="flex shrink-0">
            {Array.from({ length: count }, (_, i) => (
              // Overlap only within a run of identical pieces — the glyphs are dense filled
              // silhouettes, so overlapping *different* shapes (the pre-fix behavior) merged
              // them into an unreadable blob instead of a readable stack.
              <span key={i} className="shrink-0" style={i === 0 ? undefined : { marginLeft: '-0.28em' }}>
                {GHOST_GLYPHS.b[piece]}
              </span>
            ))}
          </span>
        ))}
      </span>
      {!!advantage && advantage > 0 && (
        <span
          data-testid={`material-advantage-${capturedColor}`}
          className="ml-1 shrink-0 text-xs font-semibold text-text-dim"
        >
          +{advantage}
        </span>
      )}
    </span>
  );
}
