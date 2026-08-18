import { useState } from 'react';
import { Board } from '../components/Board.js';

interface BoardScreenProps {
  initialFen: string;
}

/**
 * Local-only board sandbox (`docs/DESIGN.md` M2 — no networking until T-13/T-14). Reached via
 * the `fen` query param (see `readFenParam` in `App.tsx`) so T-11's e2e spec can set up
 * arbitrary positions without a room/server round trip.
 */
export function BoardScreen({ initialFen }: BoardScreenProps) {
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-100">
      <Board initialFen={initialFen} orientation={orientation} />
      <button
        type="button"
        data-testid="flip-board-button"
        onClick={() => setOrientation((current) => (current === 'white' ? 'black' : 'white'))}
        className="rounded bg-slate-700 px-4 py-2 text-sm font-medium"
      >
        Flip board
      </button>
    </main>
  );
}
