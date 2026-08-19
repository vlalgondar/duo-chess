import type { ClientRoomView, PromotionPiece, Square } from '@duo/shared';
import { Board } from '../components/Board.js';
import { Clock } from '../components/Clock.js';

interface GameScreenProps {
  view: ClientRoomView;
  onMove: (from: Square, to: Square, promotion?: PromotionPiece) => void;
  serverClockOffsetMs: number;
}

/**
 * Networked game screen (T-14 — "Networked 1v1"). No optimistic commit: the board always
 * renders `view.game.fen` as received from the server's `state` broadcast, and a move attempt
 * only ever sends `propose` (via `Board`'s `serverFen`/`onMove`, see its doc comment). The
 * propose/accept UI (ghost piece, arrow, team panel) is T-20's job — this screen is deliberately
 * plain, since with `startOneVOneGame` every team is solo and every legal propose auto-commits.
 */
export function GameScreen({ view, onMove, serverClockOffsetMs }: GameScreenProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const orientation = you?.team === 'BLACK' ? 'black' : 'white';
  const game = view.game;

  if (!game) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-100">
        <p data-testid="game-status">Waiting for the game to start…</p>
      </main>
    );
  }

  const statusText =
    game.status === 'ACTIVE'
      ? you?.team === game.sideToMove
        ? 'Your move'
        : "Opponent's move"
      : `Game over — ${game.status}${game.winner ? ` (${game.winner} wins)` : ''}`;

  // §4.6: `baseMs: 0` is "Unlimited — no clock" — nothing to show or interpolate.
  const showClocks = view.settings.timeControl.baseMs > 0;
  const top = orientation === 'white' ? 'BLACK' : 'WHITE';
  const bottom = orientation === 'white' ? 'WHITE' : 'BLACK';

  return (
    <main
      data-testid="game-shell"
      className="flex min-h-dvh flex-col items-center gap-4 bg-slate-950 p-6 text-slate-100"
    >
      <p data-testid="game-status" className="text-sm text-slate-400">
        {statusText}
      </p>
      {showClocks && (
        <Clock
          clock={game.clock}
          team={top}
          sideToMove={game.sideToMove}
          serverClockOffsetMs={serverClockOffsetMs}
          active={game.status === 'ACTIVE' && game.sideToMove === top}
        />
      )}
      <Board
        serverFen={game.fen}
        orientation={orientation}
        onMove={game.status === 'ACTIVE' ? onMove : undefined}
        sizeClassName="mx-auto w-full max-w-[560px]"
      />
      {showClocks && (
        <Clock
          clock={game.clock}
          team={bottom}
          sideToMove={game.sideToMove}
          serverClockOffsetMs={serverClockOffsetMs}
          active={game.status === 'ACTIVE' && game.sideToMove === bottom}
        />
      )}
    </main>
  );
}
