import { useState } from 'react';
import { Chess } from 'chess.js';
import { GAME_OVER_REASON, type ClientRoomView } from '@duo/shared';
import { Board } from '../components/Board.js';
import { LeaveButton } from '../ui/LeaveButton.js';
import { Button } from '../ui/Button.js';
import { Check, Copy } from '../ui/Icon.js';

interface ResultScreenProps {
  view: ClientRoomView;
  onRematch: () => void;
  onLeave: () => void;
}

/**
 * §5.6 Result screen: outcome banner (with reason), final position, move
 * list, PGN copy button, and Rematch. Reached once `RoomDO` moves a
 * game-ending commit/vote/flag-fall/abandonment to `phase: 'FINISHED'`
 * (T-26) — `App.tsx` routes here instead of `GameScreen` for that phase.
 */
export function ResultScreen({ view, onRematch, onLeave }: ResultScreenProps) {
  const game = view.game;
  const you = view.seats.find((seat) => seat.publicId === view.you);

  if (!game) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6">
        <p data-testid="result-banner">Game over</p>
        <LeaveButton onLeave={onLeave} />
      </main>
    );
  }

  const orientation = you?.team === 'BLACK' ? 'black' : 'white';
  const reason = GAME_OVER_REASON[game.status];
  const outcome = game.winner ? `${game.winner} wins` : 'Draw';
  const youTeam = you?.team ?? null;
  const youWon = youTeam !== null && game.winner === youTeam;
  const youLost = youTeam !== null && game.winner !== null && game.winner !== youTeam;
  const bannerClass = youWon
    ? 'border-primary/50 bg-primary/10 text-primary'
    : youLost
      ? 'border-danger/50 bg-danger/10 text-danger-hi'
      : 'border-line bg-surface text-text';

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 p-6">
      <h1
        data-testid="result-banner"
        className={`rounded-xl border px-6 py-3 text-center font-display text-2xl font-bold ${bannerClass}`}
      >
        {outcome} — {reason}
      </h1>

      <Board serverFen={game.fen} orientation={orientation} locked sizeClassName="mx-auto w-full max-w-[420px]" />

      <MoveList moveHistory={game.moveHistory} />

      <PgnCopyButton moveHistory={game.moveHistory} />

      {you && (
        <Button data-testid="rematch-button" variant="primary" size="lg" onClick={onRematch} className="w-64">
          Rematch
        </Button>
      )}

      <LeaveButton onLeave={onLeave} />
    </main>
  );
}

function MoveList({ moveHistory }: { moveHistory: readonly string[] }) {
  const rows: Array<{ number: number; white: string; black: string | undefined }> = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moveHistory[i]!, black: moveHistory[i + 1] });
  }

  return (
    <ol data-testid="move-list" className="flex w-full max-w-sm flex-col gap-1 rounded-xl border border-line bg-surface p-3 font-mono text-sm">
      {rows.map((row) => (
        <li key={row.number} data-testid="move-row" className="flex gap-2">
          <span className="w-6 text-text-dim">{row.number}.</span>
          <span className="w-16 text-text">{row.white}</span>
          <span className="w-16 text-text">{row.black ?? ''}</span>
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
    <Button data-testid="pgn-copy-button" variant="link" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {copied ? 'Copied!' : 'Copy PGN'}
    </Button>
  );
}
