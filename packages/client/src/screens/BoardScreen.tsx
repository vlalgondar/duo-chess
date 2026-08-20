import { useState } from 'react';
import { Board } from '../components/Board.js';
import { BottomSheet } from '../components/BottomSheet.js';
import { TeamPanel } from '../components/TeamPanel.js';
import { Panel } from '../ui/Panel.js';
import { Button } from '../ui/Button.js';

interface BoardScreenProps {
  initialFen: string;
}

// `docs/DESIGN.md` §5.10's exact formula. Below 900px the peeked bottom sheet (120px) plus
// the flip button/margins above it need headroom, so the board caps at viewport height minus
// that chrome rather than the raw `100dvh`. At ≥900px the bottom sheet is gone (replaced by
// `side-panel`), but this screen's own chrome — `p-6` main padding + one `gap-4` + the Flip
// board button — still adds up (~108px), so the same "min(cap, calc(100dvh - chrome))" pattern
// applies there too (matching `GameScreen.tsx`'s desktop formula) instead of a flat max-w that
// can force the page to scroll on a short window. `w-full` (kept from before) still shrinks the
// board for a narrow-but->=900px window; `max-w` is what adds the height ceiling.
const BOARD_SIZE_CLASSNAME =
  'mx-auto w-[min(100vw,calc(100dvh_-_220px))] min-[900px]:w-full min-[900px]:max-w-[max(360px,min(560px,calc(100dvh_-_160px)))]';

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
      className="flex min-h-dvh flex-col min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-center min-[900px]:gap-6 min-[900px]:p-6"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pb-[220px] min-[900px]:p-0">
        <Board initialFen={initialFen} orientation={orientation} sizeClassName={BOARD_SIZE_CLASSNAME} />
        <Button
          type="button"
          data-testid="flip-board-button"
          variant="secondary"
          onClick={() => setOrientation((current) => (current === 'white' ? 'black' : 'white'))}
        >
          Flip board
        </Button>
      </div>

      <Panel data-testid="side-panel" className="hidden w-72 flex-col min-[900px]:flex">
        <TeamPanel />
      </Panel>

      <BottomSheet />
    </main>
  );
}
