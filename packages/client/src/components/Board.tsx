import { forwardRef, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';

// `react-chessboard`'s own prop types (`CustomSquareProps`, its `Square`/`Piece` aliases)
// aren't re-exported from the package root, only from an internal dist path — so these are
// hand-rolled to match the shapes it actually calls our props with (docs/DESIGN.md §2.1 names
// the library; the missing type exports are the library's own gap, not a reason to reach past
// its public entry point).
type PromotionPiece = 'q' | 'r' | 'b' | 'n';
const PROMOTION_PIECES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];
const PROMOTION_LABELS: Record<PromotionPiece, string> = { q: 'Q', r: 'R', b: 'B', n: 'N' };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SELECTED_STYLE: CSSProperties = { backgroundColor: 'rgba(45, 212, 191, 0.4)' };
const LAST_MOVE_STYLE: CSSProperties = { backgroundColor: 'rgba(250, 204, 21, 0.35)' };
const CHECK_STYLE: CSSProperties = { boxShadow: 'inset 0 0 1.4em 0.5em rgba(220, 38, 38, 0.85)' };

const DOT_STYLE: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '28%',
  height: '28%',
  transform: 'translate(-50%, -50%)',
  borderRadius: '50%',
  backgroundColor: 'rgba(0, 0, 0, 0.28)',
  pointerEvents: 'none',
};

const RING_STYLE: CSSProperties = {
  position: 'absolute',
  inset: '4%',
  borderRadius: '50%',
  border: '0.35em solid rgba(0, 0, 0, 0.28)',
  boxSizing: 'border-box',
  pointerEvents: 'none',
};

interface LastMove {
  from: Square;
  to: Square;
}

interface PendingPromotion {
  from: Square;
  to: Square;
}

interface SquareContentProps {
  children: ReactNode;
  square: string;
  style: CSSProperties;
}

/**
 * Renders inside the library's own drop-target square div — see the comment above. Built with
 * `forwardRef` so the library's own square-position tracking (used for arrows, T-22) still gets
 * a real DOM node; cast back to a plain function type at the call site because `forwardRef`'s
 * generated type and the library's un-exported `CustomSquareProps` disagree on the shape of
 * `ref` under `exactOptionalPropertyTypes`, which is a typing gap in the library, not a real
 * incompatibility in the props actually passed at runtime.
 */
function makeSquareContent(dotSquares: Set<Square>, ringSquares: Set<Square>) {
  const SquareContent = forwardRef<HTMLDivElement, SquareContentProps>(function SquareContent(
    { children, square, style },
    ref,
  ) {
    return (
      <div ref={ref} style={{ ...style, position: 'relative' }}>
        {children}
        {dotSquares.has(square as Square) && <div data-testid="legal-dot" style={DOT_STYLE} />}
        {ringSquares.has(square as Square) && <div data-testid="legal-ring" style={RING_STYLE} />}
      </div>
    );
  });
  return SquareContent as unknown as (props: SquareContentProps) => ReactNode;
}

interface BoardProps {
  initialFen?: string;
  orientation?: 'white' | 'black';
  /** Overrides the wrapping div's sizing classes (default: a fixed 640px desktop cap). */
  sizeClassName?: string;
  /**
   * T-14: when set, the board is server-controlled — it always renders this exact FEN, and an
   * attempted move calls `onMove` instead of applying locally, so nothing changes on screen
   * until the server's next `serverFen` confirms it ("no optimistic commit", DESIGN.md §8 rule
   * 2). The local `chess.js` mirror is kept in sync with `serverFen` so legal-move dots/rings/
   * check-glow still render instantly (§2.3) — only the *commit* is deferred, not the hints.
   */
  serverFen?: string;
  onMove?: ((from: Square, to: Square, promotion?: PromotionPiece) => void) | undefined;
}

function createGame(fen: string): Chess {
  try {
    return new Chess(fen);
  } catch {
    // `initialFen` can come straight from a URL query param (the sandbox route in
    // `App.tsx`) — an external input, so a malformed value falls back rather than
    // crashing the whole app with no error boundary to catch it.
    return new Chess(START_FEN);
  }
}

/**
 * Fully controlled `react-chessboard` wrapper: every move is decided here first, then written
 * back into `position`, so an illegal drop or a promotion still awaiting a piece choice never
 * touches the rendered FEN. Two modes, chosen by whether `serverFen` is passed:
 *  - **Local** (`docs/DESIGN.md` M2, T-11/T-12): no `serverFen` — owns its own `chess.js` game
 *    and commits moves locally. Used by the local sandbox (`?fen=` in `App.tsx`).
 *  - **Networked** (T-14): `serverFen` set — renders exactly that FEN and calls `onMove` instead
 *    of committing, so nothing moves on screen until the server confirms it. Used by `GameScreen`.
 */
export function Board({
  initialFen = START_FEN,
  orientation = 'white',
  sizeClassName = 'mx-auto w-full max-w-[640px]',
  serverFen,
  onMove,
}: BoardProps) {
  const networked = serverFen !== undefined;
  const gameRef = useRef(createGame(serverFen ?? initialFen));
  // Ref-only resync during render, same pattern as React's "adjust state while rendering"
  // recipe — no `setState` here, so it can't loop, and it keeps `game` correct for this same
  // render pass instead of lagging a frame behind in an effect.
  if (networked && gameRef.current.fen() !== serverFen) {
    gameRef.current = createGame(serverFen);
  }
  const game = gameRef.current;

  const [internalFen, setInternalFen] = useState(() => game.fen());
  const fen = networked ? (serverFen as string) : internalFen;
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  const legalMoves = useMemo(
    () => (selected ? game.moves({ square: selected, verbose: true }) : []),
    [game, selected, fen],
  );
  // `move.isCapture()` only covers the `CAPTURE` flag, not `EP_CAPTURE` — an en passant
  // capture still sets `captured`, so check that instead to render it as a ring, not a dot.
  const dotSquares = useMemo(
    () => new Set(legalMoves.filter((move) => move.captured === undefined).map((move) => move.to)),
    [legalMoves],
  );
  const ringSquares = useMemo(
    () => new Set(legalMoves.filter((move) => move.captured !== undefined).map((move) => move.to)),
    [legalMoves],
  );
  const checkSquare = useMemo(
    () => (game.inCheck() ? game.findPiece({ type: 'k', color: game.turn() })[0] ?? null : null),
    [game, fen],
  );

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (selected) styles[selected] = { ...styles[selected], ...SELECTED_STYLE };
    if (lastMove) {
      styles[lastMove.from] = { ...styles[lastMove.from], ...LAST_MOVE_STYLE };
      styles[lastMove.to] = { ...styles[lastMove.to], ...LAST_MOVE_STYLE };
    }
    if (checkSquare) styles[checkSquare] = { ...styles[checkSquare], ...CHECK_STYLE };
    return styles;
  }, [selected, lastMove, checkSquare]);

  const SquareContent = useMemo(() => makeSquareContent(dotSquares, ringSquares), [dotSquares, ringSquares]);

  function commitMove(from: Square, to: Square, promotion?: PromotionPiece): boolean {
    if (networked) {
      // No optimistic apply: `onMove` sends `propose` and the board stays exactly at
      // `serverFen` until the server's own broadcast moves it (§8 rule 2).
      onMove?.(from, to, promotion);
      setSelected(null);
      setPendingPromotion(null);
      return false;
    }

    try {
      game.move(promotion ? { from, to, promotion } : { from, to });
    } catch {
      return false;
    }
    setInternalFen(game.fen());
    setLastMove({ from, to });
    setSelected(null);
    setPendingPromotion(null);
    return true;
  }

  function needsPromotionChoice(from: Square, to: Square): boolean {
    return game.moves({ square: from, verbose: true }).some((move) => move.to === to && move.isPromotion());
  }

  function attemptMove(from: Square, to: Square): boolean {
    if (needsPromotionChoice(from, to)) {
      setPendingPromotion({ from, to });
      setSelected(null);
      return false;
    }
    return commitMove(from, to);
  }

  function handleSquareClick(square: string, piece: string | undefined) {
    if (pendingPromotion) return;
    const clicked = square as Square;
    if (selected && (dotSquares.has(clicked) || ringSquares.has(clicked))) {
      attemptMove(selected, clicked);
      return;
    }
    setSelected(selected === clicked ? null : piece ? clicked : null);
  }

  function handlePieceDrop(sourceSquare: string, targetSquare: string): boolean {
    if (pendingPromotion) return false;
    return attemptMove(sourceSquare as Square, targetSquare as Square);
  }

  return (
    <div data-testid="board" className={`relative ${sizeClassName}`}>
      {/* Test-only accessor, same spirit as the harness's `debugState()` — lets e2e specs
          assert on the authoritative FEN instead of reverse-engineering it from piece markup. */}
      <span data-testid="fen" className="sr-only">
        {fen}
      </span>
      <Chessboard
        position={fen}
        boardOrientation={orientation}
        onSquareClick={handleSquareClick}
        onPieceDrop={handlePieceDrop}
        onPromotionCheck={() => false}
        customSquare={SquareContent}
        customSquareStyles={customSquareStyles}
      />

      {pendingPromotion && (
        <div
          data-testid="promotion-picker"
          className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70"
        >
          <div className="flex items-center gap-2 rounded bg-slate-900 p-4">
            {PROMOTION_PIECES.map((piece) => (
              <button
                key={piece}
                type="button"
                data-testid={`promote-${piece}`}
                onClick={() => commitMove(pendingPromotion.from, pendingPromotion.to, piece)}
                className="flex h-14 w-14 items-center justify-center rounded bg-slate-800 text-2xl font-bold text-slate-100 hover:bg-slate-700"
              >
                {PROMOTION_LABELS[piece]}
              </button>
            ))}
            <button
              type="button"
              data-testid="promotion-cancel"
              onClick={() => setPendingPromotion(null)}
              className="ml-2 rounded px-2 text-sm text-slate-400 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
