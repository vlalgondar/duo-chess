import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { AnnotationColor, WireAnnotation } from '@duo/shared';

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

/**
 * `docs/DESIGN.md` §5.5 "Proposal visuals": a translucent ghost piece on the
 * destination square plus a solid arrow, in the team's accent color. Unicode
 * glyphs rather than the library's own piece images — `react-chessboard`
 * doesn't expose its piece SVGs for reuse outside `position` (same "public
 * entry point only" precedent T-11 already established for this library).
 */
export interface ProposalOverlay {
  from: Square;
  to: Square;
  promotion?: PromotionPiece | undefined;
  /** CSS color for the arrow/ghost — the proposing team's accent (§5.9: "in your team's accent color"). */
  accentColor: string;
}

const GHOST_GLYPHS: Record<'w' | 'b', Record<'p' | 'n' | 'b' | 'r' | 'q' | 'k', string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

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
function makeSquareContent(
  dotSquares: Set<Square>,
  ringSquares: Set<Square>,
  ghost: { square: Square; glyph: string; accentColor: string } | null,
) {
  const SquareContent = forwardRef<HTMLDivElement, SquareContentProps>(function SquareContent(
    { children, square, style },
    ref,
  ) {
    return (
      <div ref={ref} style={{ ...style, position: 'relative' }}>
        {children}
        {dotSquares.has(square as Square) && <div data-testid="legal-dot" style={DOT_STYLE} />}
        {ringSquares.has(square as Square) && <div data-testid="legal-ring" style={RING_STYLE} />}
        {ghost && ghost.square === square && (
          <div
            data-testid="proposal-ghost"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '250%',
              lineHeight: 1,
              color: ghost.accentColor,
              opacity: 0.55,
              pointerEvents: 'none',
            }}
          >
            {ghost.glyph}
          </div>
        )}
      </div>
    );
  });
  return SquareContent as unknown as (props: SquareContentProps) => ReactNode;
}

/** §5.9's 200ms long-press threshold — short enough to feel responsive, long enough not to fight piece dragging. */
const LONG_PRESS_MS = 200;

/** Same gesture (kind + squares), ignoring color/author — the "repeat to erase" toggle key (§5.9). */
function sameAnnotationShape(a: WireAnnotation, b: WireAnnotation): boolean {
  return a.kind === b.kind && a.from === b.from && a.to === b.to;
}

/** The `[data-square]` ancestor of `target`, if any — same attribute `dragPiece`'s e2e helper already relies on. */
function squareFromTarget(target: EventTarget | null): Square | null {
  const el = target instanceof Element ? target.closest('[data-square]') : null;
  return el ? (el.getAttribute('data-square') as Square) : null;
}

function squareAtPoint(x: number, y: number): Square | null {
  return squareFromTarget(document.elementFromPoint(x, y));
}

/** Center of `square`'s cell as a percentage of the board, accounting for orientation. */
function squareCenterPercent(square: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0-7, a=0
  const rank = Number(square[1]) - 1; // 0-7, rank 1 = 0
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank; // rank 8 at the top when white is at the bottom
  return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
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
  /**
   * T-20: when true (off-turn, per §5.5 "pieces are not draggable"), no square can be
   * selected and no piece can be dragged — the server would reject the move anyway
   * (`NOT_YOUR_TURN`), but the design wants that reflected in the board itself, not just
   * an error round trip.
   */
  locked?: boolean;
  /** T-20: the viewer's own team's live proposal, rendered as a ghost piece + arrow (§5.5). */
  proposal?: ProposalOverlay | null;
  /**
   * T-22: the viewer's own team's full annotation set as last confirmed by the server (both
   * teammates', §5.9) — `view.annotations`. Board renders the *teammate's* entries from this
   * prop and its own freshly-drawn ones from local state (see `ownAnnotationColor`), so nothing
   * has to wait for a server round trip to appear on the drawer's own screen.
   */
  annotations?: readonly WireAnnotation[];
  /**
   * T-22: this viewer's fixed drawing color (`roomEngine.annotationColorFor`) — presence of this
   * prop is what turns annotation drawing on at all (omitted entirely by the local sandbox and by
   * spectators/unassigned seats, who have no team to draw for).
   */
  ownAnnotationColor?: AnnotationColor | undefined;
  /** T-22: hex colors for the two possible drawers, distinct from `proposal`'s team accent (§5.9). */
  annotationColors?: Record<AnnotationColor, string> | undefined;
  /** T-22: fires (debounced 80ms) with the viewer's own full set whenever it changes locally — the caller sends it as `annotate`. */
  onAnnotationsChange?: (annotations: WireAnnotation[]) => void;
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
  locked = false,
  proposal = null,
  annotations,
  ownAnnotationColor,
  annotationColors,
  onAnnotationsChange,
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

  // T-22 board annotations (§5.9). `annotationsEnabled` is false for the local sandbox and for
  // spectators/unassigned seats — neither has a color to draw with.
  const annotationsEnabled = ownAnnotationColor !== undefined;
  const [ownAnnotations, setOwnAnnotations] = useState<WireAnnotation[]>([]);

  // "Cleared automatically on every commit" (§5.9) — the position changing is exactly what a
  // commit *is*, so resetting on a `fen` change (the same render-time resync pattern the
  // networked `gameRef` above already uses) needs no separate signal from the server.
  const prevAnnotationFenRef = useRef(fen);
  if (fen !== prevAnnotationFenRef.current) {
    prevAnnotationFenRef.current = fen;
    if (ownAnnotations.length > 0) setOwnAnnotations([]);
  }

  // A ref, not a dependency, so a parent re-render (which recreates this callback on every
  // render, same as every other handler `App.tsx` passes down) can't reset the debounce timer.
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  onAnnotationsChangeRef.current = onAnnotationsChange;
  useEffect(() => {
    if (!annotationsEnabled) return;
    // §5.9: "Full replacement of your own set ... debounced at 80ms."
    const timer = setTimeout(() => onAnnotationsChangeRef.current?.(ownAnnotations), 80);
    return () => clearTimeout(timer);
  }, [ownAnnotations, annotationsEnabled]);

  function toggleOwnAnnotation(next: WireAnnotation) {
    setOwnAnnotations((prev) =>
      prev.some((a) => sameAnnotationShape(a, next))
        ? prev.filter((a) => !sameAnnotationShape(a, next))
        : [...prev, next],
    );
  }

  const rightClickDownRef = useRef<Square | null>(null);

  function handleBoardContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  function handleBoardMouseDown(e: React.MouseEvent) {
    if (!annotationsEnabled || e.button !== 2) return;
    rightClickDownRef.current = squareFromTarget(e.target);
  }

  function handleBoardMouseUp(e: React.MouseEvent) {
    if (!annotationsEnabled || e.button !== 2 || !ownAnnotationColor) return;
    const from = rightClickDownRef.current;
    rightClickDownRef.current = null;
    const to = squareFromTarget(e.target);
    if (!from || !to) return;
    toggleOwnAnnotation(
      from === to
        ? { kind: 'CIRCLE', from, color: ownAnnotationColor }
        : { kind: 'ARROW', from, to, color: ownAnnotationColor },
    );
  }

  // Touch equivalent (§5.9): long-press-tap for a circle, long-press-and-drag for an arrow.
  // `LONG_PRESS_MS` keeps a quick tap free to mean what it already means elsewhere (tap-tap
  // movement, T-12) rather than starting to draw.
  const touchAnnotateRef = useRef<{ square: Square; longPress: boolean } | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (touchTimerRef.current) clearTimeout(touchTimerRef.current); }, []);

  function handleBoardTouchStart(e: React.TouchEvent) {
    if (!annotationsEnabled) return;
    const touch = e.touches[0];
    const square = touch ? squareAtPoint(touch.clientX, touch.clientY) : null;
    if (!square) return;
    const state = { square, longPress: false };
    touchAnnotateRef.current = state;
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      state.longPress = true;
    }, LONG_PRESS_MS);
  }

  function handleBoardTouchEnd(e: React.TouchEvent) {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    const state = touchAnnotateRef.current;
    touchAnnotateRef.current = null;
    if (!state?.longPress || !ownAnnotationColor) return;
    const touch = e.changedTouches[0];
    const endSquare = (touch && squareAtPoint(touch.clientX, touch.clientY)) ?? state.square;
    toggleOwnAnnotation(
      endSquare === state.square
        ? { kind: 'CIRCLE', from: state.square, color: ownAnnotationColor }
        : { kind: 'ARROW', from: state.square, to: endSquare, color: ownAnnotationColor },
    );
  }

  const teammateAnnotations = useMemo(
    () => (annotations ?? []).filter((a) => a.color !== ownAnnotationColor),
    [annotations, ownAnnotationColor],
  );
  const renderedAnnotations = annotationsEnabled ? [...teammateAnnotations, ...ownAnnotations] : [];

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

  const ghost = useMemo(() => {
    if (!proposal) return null;
    const piece = game.get(proposal.from);
    if (!piece) return null;
    const type = proposal.promotion ?? piece.type;
    return { square: proposal.to, glyph: GHOST_GLYPHS[piece.color][type], accentColor: proposal.accentColor };
  }, [proposal, game, fen]);

  const SquareContent = useMemo(() => makeSquareContent(dotSquares, ringSquares, ghost), [dotSquares, ringSquares, ghost]);

  const arrow = useMemo(() => {
    if (!proposal) return null;
    return {
      from: squareCenterPercent(proposal.from, orientation),
      to: squareCenterPercent(proposal.to, orientation),
      accentColor: proposal.accentColor,
    };
  }, [proposal, orientation]);

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
    // §5.9: "Left-click anywhere on the board clears all your own annotations" — independent of
    // `locked`/`pendingPromotion`, since it's not a move attempt.
    if (annotationsEnabled && ownAnnotations.length > 0) setOwnAnnotations([]);
    if (pendingPromotion || locked) return;
    const clicked = square as Square;
    if (selected && (dotSquares.has(clicked) || ringSquares.has(clicked))) {
      attemptMove(selected, clicked);
      return;
    }
    setSelected(selected === clicked ? null : piece ? clicked : null);
  }

  function handlePieceDrop(sourceSquare: string, targetSquare: string): boolean {
    if (pendingPromotion || locked) return false;
    return attemptMove(sourceSquare as Square, targetSquare as Square);
  }

  return (
    <div
      data-testid="board"
      className={`relative ${sizeClassName}`}
      onContextMenu={handleBoardContextMenu}
      onMouseDown={handleBoardMouseDown}
      onMouseUp={handleBoardMouseUp}
      onTouchStart={handleBoardTouchStart}
      onTouchEnd={handleBoardTouchEnd}
    >
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
        arePiecesDraggable={!locked}
        // The library's own right-click-drag arrow feature is superseded by our own overlay
        // below (per-annotation colors, plus circles, which it has no concept of) — disabled so
        // it never renders a second, undifferentiated arrow underneath ours.
        areArrowsAllowed={false}
      />

      {/* §5.9: teammate-only scribbles, `pointer-events: none` so they never intercept a click
          or drag through an annotated square — see the mouse/touch handlers above for drawing. */}
      {renderedAnnotations.length > 0 && (
        <svg
          data-testid="annotation-overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-10"
        >
          {renderedAnnotations.map((a, i) => {
            const color = annotationColors?.[a.color] ?? 'currentColor';
            const from = squareCenterPercent(a.from, orientation);
            // `to` presence (not just `kind`) is what TS can actually narrow on here — `Annotation`/
            // `WireAnnotation` are one flat type with an optional `to`, not a discriminated union.
            if (a.kind === 'ARROW' && a.to !== undefined) {
              const to = squareCenterPercent(a.to, orientation);
              const markerId = `annotation-arrowhead-${i}`;
              return (
                <g key={`arrow-${a.from}-${a.to}-${a.color}`} data-testid="annotation-arrow">
                  <defs>
                    <marker id={markerId} markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto">
                      <path d="M0,0 L4,2 L0,4 Z" fill={color} />
                    </marker>
                  </defs>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={color}
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    opacity={0.85}
                    markerEnd={`url(#${markerId})`}
                  />
                </g>
              );
            }
            return (
              <circle
                key={`circle-${a.from}-${a.color}`}
                data-testid="annotation-circle"
                cx={from.x}
                cy={from.y}
                r={5.2}
                fill="none"
                stroke={color}
                strokeWidth={1.4}
                opacity={0.85}
              />
            );
          })}
        </svg>
      )}

      {arrow && (
        <svg
          data-testid="proposal-arrow"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-10"
        >
          <defs>
            <marker id="proposal-arrowhead" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto">
              <path d="M0,0 L4,2 L0,4 Z" fill={arrow.accentColor} />
            </marker>
          </defs>
          <line
            x1={arrow.from.x}
            y1={arrow.from.y}
            x2={arrow.to.x}
            y2={arrow.to.y}
            stroke={arrow.accentColor}
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.85}
            markerEnd="url(#proposal-arrowhead)"
          />
        </svg>
      )}

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
