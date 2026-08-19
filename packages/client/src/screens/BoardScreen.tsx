import { useState } from 'react';
import { Board } from '../components/Board.js';
import { BottomSheet } from '../components/BottomSheet.js';
import { TeamPanel } from '../components/TeamPanel.js';

interface BoardScreenProps {
  initialFen: string;
}

// `docs/DESIGN.md` §5.10's exact formula. Below 900px the peeked bottom sheet (120px) plus
// the flip button/margins above it need headroom, so the board caps at viewport height minus
// that chrome rather than the raw `100dvh`; at ≥900px the bottom sheet is gone (replaced by
// `side-panel`) so the board just fills its column up to a fixed desktop cap.
const BOARD_SIZE_CLASSNAME =
  'mx-auto w-[min(100vw,calc(100dvh_-_220px))] min-[900px]:w-full min-[900px]:max-w-[560px]';

/**
 * Local-only board sandbox (`docs/DESIGN.md` M2 — no networking until T-13/T-14). Reached via
 * the `fen` query param (see `readFenParam` in `App.tsx`) so T-11's and T-12's e2e specs can set
 * up arbitrary positions without a room/server round trip. This is also where the §5.10
 * responsive shell lives: below 900px, `TeamPanel` moves into `BottomSheet`; at/above it, a
 * static `side-panel` holds `TeamPanel` next to the board, matching §5.5's desktop layout.
 */
export function BoardScreen({ initialFen }: BoardScreenProps) {
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  return (
    <main
      data-testid="game-shell"
      className="flex min-h-dvh flex-col bg-slate-950 text-slate-100 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-center min-[900px]:gap-6 min-[900px]:p-6"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pb-[220px] min-[900px]:p-0">
        <Board initialFen={initialFen} orientation={orientation} sizeClassName={BOARD_SIZE_CLASSNAME} />
        <button
          type="button"
          data-testid="flip-board-button"
          onClick={() => setOrientation((current) => (current === 'white' ? 'black' : 'white'))}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium"
        >
          Flip board
        </button>
      </div>

      <aside data-testid="side-panel" className="hidden w-72 flex-col rounded-lg bg-slate-900 min-[900px]:flex">
        <TeamPanel />
      </aside>

      <BottomSheet />
    </main>
  );
}
