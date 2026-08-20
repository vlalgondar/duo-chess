import { useState } from 'react';
import { Chess } from 'chess.js';
import { GAME_OVER_REASON, type ClientRoomView } from '@duo/shared';
import { Board } from '../components/Board.js';
import { LeaveButton } from '../ui/LeaveButton.js';
import { Button } from '../ui/Button.js';
import { Panel } from '../ui/Panel.js';
import { Check, Copy } from '../ui/Icon.js';

// Chrome tally at >=900px: `p-6` (48) + banner (text-2xl 32 + py-3 24 + border 2 = 58) +
// `gap-6` (24) = 130; 150 leaves 20px slack. Mirrors GameScreen's `BOARD_SIZE_CLASSNAME`
// deduction comment — see that file for why this is a hand-tallied constant, not derived.
const BOARD_SIZE_CLASSNAME =
  'mx-auto w-full max-w-[420px] min-[900px]:max-w-[max(320px,min(720px,calc(100dvh_-_150px)))]';

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
    <main className="flex min-h-dvh flex-col items-center gap-6 p-6 min-[900px]:h-dvh min-[900px]:flex-row min-[900px]:items-stretch min-[900px]:justify-center">
      {/* `flex-1` (mirrors GameScreen's board column) — without it the row gives this column
          only its shrink-to-fit content width, which circularly caps `Board`'s own `w-full` at
          the banner's intrinsic width instead of the available row space.
          `justify-center-safe`, not `justify-center`: on a window too short for banner+board,
          plain centering overflows upward — which is unreachable, since the page can't scroll
          past the top of a centered flex item. Safe alignment degrades to top-aligned instead. */}
      <div className="flex min-w-0 flex-col items-center gap-6 min-[900px]:flex-1 min-[900px]:justify-center-safe">
        <h1
          data-testid="result-banner"
          className={`rounded-xl border px-6 py-3 text-center font-display text-2xl font-bold ${bannerClass}`}
        >
          {outcome} — {reason}
        </h1>

        <Board serverFen={game.fen} orientation={orientation} locked sizeClassName={BOARD_SIZE_CLASSNAME} />
      </div>

      {/* `contents` below 900px keeps these as plain siblings of the banner/board in `main`'s
          own centered column — pixel-identical to the pre-desktop-layout markup. At >=900px it
          becomes the real right-hand panel; `main`'s `h-dvh` + `items-stretch` give it a
          definite height so the move list can scroll internally instead of growing the page. */}
      <Panel className="contents min-[900px]:flex min-[900px]:w-72 min-[900px]:min-h-0 min-[900px]:flex-col min-[900px]:gap-3 min-[900px]:p-3">
        <MoveList moveHistory={game.moveHistory} />

        <PgnCopyButton moveHistory={game.moveHistory} />

        {you && (
          <Button
            data-testid="rematch-button"
            variant="primary"
            size="lg"
            onClick={onRematch}
            className="w-64 min-[900px]:w-full min-[900px]:shrink-0"
          >
            Rematch
          </Button>
        )}

        <LeaveButton onLeave={onLeave} className="w-64 min-[900px]:w-full min-[900px]:shrink-0" />
      </Panel>
    </main>
  );
}

function MoveList({ moveHistory }: { moveHistory: readonly string[] }) {
  const rows: Array<{ number: number; white: string; black: string | undefined }> = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moveHistory[i]!, black: moveHistory[i + 1] });
  }

  return (
    <ol
      data-testid="move-list"
      className="flex w-full max-w-sm max-h-40 flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-3 font-mono text-sm min-[900px]:min-h-0 min-[900px]:max-h-none min-[900px]:max-w-none min-[900px]:flex-1 min-[900px]:overflow-y-auto min-[900px]:border-0 min-[900px]:bg-transparent min-[900px]:p-0"
    >
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
