import { useState } from 'react';
import { MAX_SEATS, MAX_TEAM_SIZE, type PublicSeat, type PublicSpectator, type Team } from '@duo/shared';

interface SpectatorsProps {
  spectators: readonly PublicSpectator[];
  /**
   * Host-only "promote into an empty seat" (§5.7). Omitted entirely during
   * `IN_GAME` (`GameScreen` never passes it — `promote_spectator` is
   * rejected server-side there anyway, see `roomEngine.promoteSpectator`),
   * so the buttons only ever appear where the action can actually succeed.
   */
  onPromote?: ((publicId: string, team: Team) => void) | undefined;
  seats: readonly PublicSeat[];
}

/**
 * §5.7: "Spectator count is shown to players (👁 2); the roster is visible
 * on hover." Implemented as click-to-toggle rather than a CSS `:hover`
 * reveal — hover has no touch equivalent, and §9's mobile-first-class rule
 * means the roster must be reachable on a phone too.
 */
export function Spectators({ spectators, onPromote, seats }: SpectatorsProps) {
  const [expanded, setExpanded] = useState(false);
  if (spectators.length === 0) return null;

  const seatsFull = seats.length >= MAX_SEATS;
  const teamCount = (team: Team) => seats.filter((s) => s.team === team).length;

  return (
    <div data-testid="spectators" className="flex flex-col items-center gap-1 text-xs text-slate-400">
      <button
        type="button"
        data-testid="spectator-count"
        onClick={() => setExpanded((current) => !current)}
        className="underline decoration-dotted"
      >
        {'\u{1F441}'} {spectators.length} spectator{spectators.length === 1 ? '' : 's'}
      </button>

      {expanded && (
        <ul data-testid="spectator-roster" className="flex w-64 flex-col gap-1 rounded bg-slate-900 p-2">
          {spectators.map((spectator) => (
            <li key={spectator.publicId} data-testid="spectator-item" className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${spectator.connected ? 'bg-emerald-500' : 'bg-slate-600'}`}
                />
                {spectator.username}
              </span>
              {onPromote && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    data-testid="promote-white"
                    disabled={seatsFull || teamCount('WHITE') >= MAX_TEAM_SIZE}
                    onClick={() => onPromote(spectator.publicId, 'WHITE')}
                    className="flex h-11 min-w-[44px] items-center justify-center rounded bg-slate-700 px-2 text-xs disabled:opacity-30"
                  >
                    → White
                  </button>
                  <button
                    type="button"
                    data-testid="promote-black"
                    disabled={seatsFull || teamCount('BLACK') >= MAX_TEAM_SIZE}
                    onClick={() => onPromote(spectator.publicId, 'BLACK')}
                    className="flex h-11 min-w-[44px] items-center justify-center rounded bg-slate-700 px-2 text-xs disabled:opacity-30"
                  >
                    → Black
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
