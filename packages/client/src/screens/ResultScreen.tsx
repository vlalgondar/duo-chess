import { useState } from 'react';
import { Chess } from 'chess.js';
import { GAME_OVER_REASON, type ClientRoomView } from '@duo/shared';
import { Board } from '../components/Board.js';

interface ResultScreenProps {
  view: ClientRoomView;
  onRematch: () => void;
}

/**
 * §5.6 Result screen: outcome banner (with reason), final position, move
 * list, PGN copy button, and Rematch. Reached once `RoomDO` moves a
 * game-ending commit/vote/flag-fall/abandonment to `phase: 'FINISHED'`
 * (T-26) — `App.tsx` routes here instead of `GameScreen` for that phase.
 */
export function ResultScreen({ view, onRematch }: ResultScreenProps) {
  const game = view.game;
  const you = view.seats.find((seat) => seat.publicId === view.you);

  if (!game) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-100">
        <p data-testid="result-banner">Game over</p>
      </main>
    );
  }

  const orientation = you?.team === 'BLACK' ? 'black' : 'white';
  const reason = GAME_OVER_REASON[game.status];
  const outcome = game.winner ? `${game.winner} wins` : 'Draw';

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 bg-slate-950 p-6 text-slate-100">
      <h1 data-testid="result-banner" className="text-2xl font-semibold">
        {outcome} — {reason}
      </h1>

      <Board serverFen={game.fen} orientation={orientation} locked sizeClassName="mx-auto w-full max-w-[420px]" />

      <MoveList moveHistory={game.moveHistory} />

      <PgnCopyButton moveHistory={game.moveHistory} />

      {you && (
        <button
          data-testid="rematch-button"
          type="button"
          onClick={onRematch}
          className="w-64 rounded bg-emerald-600 px-4 py-3 text-lg font-semibold"
        >
          Rematch
        </button>
      )}
    </main>
  );
}

function MoveList({ moveHistory }: { moveHistory: readonly string[] }) {
  const rows: Array<{ number: number; white: string; black: string | undefined }> = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moveHistory[i]!, black: moveHistory[i + 1] });
  }

  return (
    <ol data-testid="move-list" className="flex w-64 flex-col gap-1 rounded bg-slate-900 p-3 text-sm">
      {rows.map((row) => (
        <li key={row.number} data-testid="move-row" className="flex gap-2">
          <span className="w-6 text-slate-500">{row.number}.</span>
          <span className="w-16">{row.white}</span>
          <span className="w-16">{row.black ?? ''}</span>
        </li>
      ))}
    </ol>
  );
}

/** Builds the PGN by replaying `moveHistory` (SAN) from the standard start — every game here always starts there (`gameEngine.startGame`). */
function PgnCopyButton({ moveHistory }: { moveHistory: readonly string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const chess = new Chess();
    for (const san of moveHistory) chess.move(san);

    try {
      await navigator.clipboard.writeText(chess.pgn());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable (e.g. insecure context) — the move
      // list above still shows the same game for manual copying.
    }
  };

  return (
    <button data-testid="pgn-copy-button" type="button" onClick={handleCopy} className="text-sm text-emerald-400 underline">
      {copied ? 'Copied!' : 'Copy PGN'}
    </button>
  );
}
