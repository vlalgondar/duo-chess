import { canStartGame, MAX_TEAM_SIZE, type ClientRoomView, type PublicSeat, type Team } from '@duo/shared';
import { Spectators } from '../components/Spectators.js';
import { LeaveButton } from './Lobby.js';

/** Mirrors `RoomState['lastError']` (store.ts) — an in-session rejection, not a failed join. */
type LastError = { code: string; at: number } | null;

interface TeamSelectProps {
  view: ClientRoomView;
  lastError: LastError;
  onSetTeam: (team: Team | null) => void;
  onSetReady: (ready: boolean) => void;
  onStart: () => void;
  onRandomize: () => void;
  onPromoteSpectator: (publicId: string, team: Team) => void;
  onBackToLobby: () => void;
  onLeave: () => void;
}

/** Left-to-right strip order (§5.4): Team 1 (white) — Unassigned — Team 2 (black). */
const STRIP_ORDER: ReadonlyArray<Team | null> = ['WHITE', null, 'BLACK'];

function neighbor(team: Team | null, direction: -1 | 1): Team | null | undefined {
  const index = STRIP_ORDER.indexOf(team);
  return STRIP_ORDER[index + direction];
}

/**
 * FIFA-style team select (T-17, §5.4). Non-optimistic: every card renders
 * straight from `view.seats`, so a rejected `set_team` (e.g. `TEAM_FULL`)
 * simply never moves the card — no local state to roll back, same "server
 * state is the only truth" discipline `Board`'s networked mode already uses
 * (§8: "committed moves are not predicted").
 */
export function TeamSelect({
  view,
  lastError,
  onSetTeam,
  onSetReady,
  onStart,
  onRandomize,
  onPromoteSpectator,
  onBackToLobby,
  onLeave,
}: TeamSelectProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const isHost = you?.isHost ?? false;

  const whiteSeats = view.seats.filter((s) => s.team === 'WHITE');
  const blackSeats = view.seats.filter((s) => s.team === 'BLACK');
  const unassignedSeats = view.seats.filter((s) => s.team === null);

  const canStart =
    view.seats.length > 0 && view.seats.every((s) => s.ready) && view.seats.every((s) => s.team !== null) && canStartGame(view.seats);

  return (
    <main
      data-testid="team-select-shell"
      className="flex min-h-dvh flex-col items-center gap-6 bg-slate-950 p-6 text-slate-100"
    >
      <h1 className="text-2xl font-semibold">Team Select</h1>

      <div className="flex w-full max-w-4xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-center">
        <TeamColumn
          testId="team-panel-white"
          title="Team 1 — White"
          team="WHITE"
          seats={whiteSeats}
          you={you}
          lastError={lastError}
          onSetTeam={onSetTeam}
          onSetReady={onSetReady}
        />
        <TeamColumn
          testId="unassigned-strip"
          title="Unassigned"
          team={null}
          seats={unassignedSeats}
          you={you}
          lastError={lastError}
          onSetTeam={onSetTeam}
          onSetReady={onSetReady}
        />
        <TeamColumn
          testId="team-panel-black"
          title="Team 2 — Black"
          team="BLACK"
          seats={blackSeats}
          you={you}
          lastError={lastError}
          onSetTeam={onSetTeam}
          onSetReady={onSetReady}
        />
      </div>

      <Spectators
        spectators={view.spectators}
        seats={view.seats}
        onPromote={isHost ? onPromoteSpectator : undefined}
      />

      {isHost && (
        <button
          type="button"
          data-testid="randomize-button"
          onClick={onRandomize}
          className="text-sm text-emerald-400 underline"
        >
          Randomize teams
        </button>
      )}

      {/* Host-only, the reverse of Lobby's own Start button — gets back to Lobby-only
          settings (time control, spectators, disconnect grace) without abandoning the
          room. Clears every team pick and ready flag (roomEngine.backToLobby). */}
      {isHost && (
        <button
          type="button"
          data-testid="back-to-lobby-button"
          onClick={onBackToLobby}
          className="flex h-11 w-64 items-center justify-center rounded bg-slate-700 text-sm font-semibold text-slate-300"
        >
          Back to Lobby
        </button>
      )}

      {isHost ? (
        <button
          type="button"
          data-testid="start-game-button"
          disabled={!canStart}
          onClick={onStart}
          className="w-64 rounded bg-emerald-600 px-4 py-3 text-lg font-semibold disabled:opacity-50"
        >
          Start Game
        </button>
      ) : (
        <p className="text-sm text-slate-400">Waiting for the host to start…</p>
      )}

      <LeaveButton onLeave={onLeave} />
    </main>
  );
}

interface TeamColumnProps {
  testId: string;
  title: string;
  team: Team | null;
  seats: PublicSeat[];
  you: PublicSeat | undefined;
  lastError: LastError;
  onSetTeam: (team: Team | null) => void;
  onSetReady: (ready: boolean) => void;
}

function TeamColumn({ testId, title, team, seats, you, lastError, onSetTeam, onSetReady }: TeamColumnProps) {
  return (
    <section
      data-testid={testId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onSetTeam(team);
      }}
      className="flex min-h-[160px] flex-1 flex-col gap-2 rounded bg-slate-900 p-3"
    >
      <h2 className="flex items-center justify-between text-sm font-semibold text-slate-300">
        <span>{title}</span>
        <span className="text-xs text-slate-500">
          {seats.length}/{team ? MAX_TEAM_SIZE : seats.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {seats.map((seat) => {
          const isYou = seat.publicId === you?.publicId;
          // Re-keying on `at` remounts the card so its shake animation
          // (see `Card`) restarts even when the same rejection repeats —
          // React won't replay a CSS animation on an unchanged element just
          // because a class name is reapplied.
          const key =
            isYou && lastError?.code === 'TEAM_FULL' ? `${seat.publicId}-shake-${lastError.at}` : seat.publicId;
          return (
            <Card key={key} seat={seat} isYou={isYou} lastError={lastError} onSetTeam={onSetTeam} onSetReady={onSetReady} />
          );
        })}
      </ul>
    </section>
  );
}

interface CardProps {
  seat: PublicSeat;
  isYou: boolean;
  lastError: LastError;
  onSetTeam: (team: Team | null) => void;
  onSetReady: (ready: boolean) => void;
}

function Card({ seat, isYou, lastError, onSetTeam, onSetReady }: CardProps) {
  const left = neighbor(seat.team, -1);
  const right = neighbor(seat.team, 1);

  // §5.4: "Attempting to join a full team is refused with a small shake
  // animation." `lastError` only carries a code, not which action caused it,
  // but `TEAM_FULL` can only ever come from *your own* rejected `set_team`
  // here, so it's unambiguous without threading a request id through.
  // Re-keying on `at` restarts the CSS animation even if the same rejection
  // fires twice in a row (a repeated class name alone wouldn't retrigger it).
  const shaking = isYou && lastError?.code === 'TEAM_FULL';

  return (
    <li
      data-testid="team-card"
      data-username={seat.username}
      data-ready={seat.ready}
      draggable={isYou}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', seat.publicId);
      }}
      className={`flex items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2 text-sm ${shaking ? 'shake' : ''}`}
    >
      <span className="flex items-center gap-1">
        <span
          data-testid="connection-dot"
          data-connected={seat.connected}
          className={`h-2.5 w-2.5 rounded-full ${seat.connected ? 'bg-emerald-500' : 'bg-slate-600'}`}
        />
        {seat.username}
        {seat.isHost && <span className="text-xs text-slate-400">(host)</span>}
        {seat.ready && (
          <span data-testid="ready-check" className="text-emerald-400">
            ✓
          </span>
        )}
      </span>

      {isYou && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="move-left"
            disabled={left === undefined}
            onClick={() => onSetTeam(left ?? null)}
            className="flex h-11 min-w-[44px] items-center justify-center rounded bg-slate-700 disabled:opacity-30"
          >
            ←
          </button>
          {/* §5.4: Ready has nothing to confirm without a side chosen — `setTeam` (roomEngine.ts)
              also clears `ready` server-side on unassign, so this never hides a stale checkmark. */}
          {seat.team !== null && (
            <button
              type="button"
              data-testid="ready-toggle"
              onClick={() => onSetReady(!seat.ready)}
              className="flex h-11 min-w-[44px] items-center justify-center rounded bg-emerald-700 px-2 text-xs font-semibold disabled:opacity-30"
            >
              {seat.ready ? 'Unready' : 'Ready'}
            </button>
          )}
          <button
            type="button"
            data-testid="move-right"
            disabled={right === undefined}
            onClick={() => onSetTeam(right ?? null)}
            className="flex h-11 min-w-[44px] items-center justify-center rounded bg-slate-700 disabled:opacity-30"
          >
            →
          </button>
        </div>
      )}
    </li>
  );
}
