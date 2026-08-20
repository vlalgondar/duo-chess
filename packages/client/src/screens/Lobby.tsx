import { useState } from 'react';
import { TIME_CONTROLS, type ClientRoomView, type RoomSettings, type Team } from '@duo/shared';
import { Spectators } from '../components/Spectators.js';
import { Button } from '../ui/Button.js';
import { Panel } from '../ui/Panel.js';
import { StatusDot } from '../ui/StatusDot.js';
import { LeaveButton } from '../ui/LeaveButton.js';
import { Check, Copy } from '../ui/Icon.js';

// docs/DESIGN.md §5.3 gates Start on "every player has picked a team", but
// team assignment happens on the later Team Select screen (§5.4) per the
// §5.1 screen map — no seat has a team yet while still in the Lobby. As
// resolved at T-17 (see TASKS.md Findings): this button only advances
// LOBBY -> TEAM_SELECT, gated on player count alone; the real ready/team-size
// gate lives on Team Select's own Start Game button (`TeamSelect.tsx`).
const MIN_PLAYERS_TO_START = 2;

interface LobbyProps {
  view: ClientRoomView;
  onStart: () => void;
  onUpdateSettings: (settings: RoomSettings) => void;
  onPromoteSpectator: (publicId: string, team: Team) => void;
  onLeave: () => void;
}

export function Lobby({ view, onStart, onUpdateSettings, onPromoteSpectator, onLeave }: LobbyProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const isHost = you?.isHost ?? false;
  const canStart = view.seats.length >= MIN_PLAYERS_TO_START;
  const joinLink = `${window.location.origin}/join/${view.code}`;

  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 p-6">
      <h1 className="font-display text-2xl font-bold text-text">Duo Chess</h1>

      <section className="flex flex-col items-center gap-2">
        <p
          data-testid="room-code"
          className="rounded-lg border border-line bg-surface px-5 py-2.5 font-mono text-2xl tracking-[0.3em] text-accent"
        >
          {view.code}
        </p>
        <CopyLinkButton link={joinLink} />
      </section>

      <ul data-testid="roster" className="flex w-full max-w-sm flex-col gap-2">
        {view.seats.map((seat) => (
          <li
            key={seat.publicId}
            data-testid="roster-item"
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5"
          >
            <StatusDot connected={seat.connected} />
            <span className="text-text">{seat.username}</span>
            {seat.isHost && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">(host)</span>
            )}
          </li>
        ))}
      </ul>

      <Spectators
        spectators={view.spectators}
        seats={view.seats}
        onPromote={isHost ? onPromoteSpectator : undefined}
      />

      {isHost ? (
        <HostSettings settings={view.settings} onChange={onUpdateSettings} />
      ) : (
        <p className="text-sm text-text-muted">Time control: {view.settings.timeControl.label}</p>
      )}

      {isHost ? (
        <Button data-testid="start-button" variant="primary" size="lg" disabled={!canStart} onClick={onStart} className="w-64">
          Start
        </Button>
      ) : (
        <p className="text-sm text-text-muted">Waiting for the host to start…</p>
      )}

      <LeaveButton onLeave={onLeave} />
    </main>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable (e.g. insecure context) —
      // the code is already shown above for manual copying.
    }
  };

  return (
    <Button data-testid="copy-link-button" variant="link" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {copied ? 'Copied!' : 'Copy invite link'}
    </Button>
  );
}

/**
 * `timeControl` is a live picker over the full §4.6 option list (T-16), same
 * pattern as `allowSpectators`/`randomizeColors`/`disconnectGraceMs` below —
 * `update_settings` is wired server-side as of T-17, so every edit here now
 * round-trips and is reflected back in the next `state` broadcast.
 */
function HostSettings({
  settings,
  onChange,
}: {
  settings: RoomSettings;
  onChange: (settings: RoomSettings) => void;
}) {
  return (
    <Panel data-testid="host-settings" className="flex w-full max-w-sm flex-col gap-3 p-4 text-sm">
      <label className="flex items-center justify-between gap-2 text-text-muted">
        Time control
        <select
          data-testid="time-control-select"
          value={settings.timeControl.label}
          onChange={(event) => {
            const timeControl = TIME_CONTROLS.find((tc) => tc.label === event.target.value);
            if (timeControl) onChange({ ...settings, timeControl });
          }}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-text"
        >
          {TIME_CONTROLS.map((tc) => (
            <option key={tc.label} value={tc.label}>
              {tc.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 text-text-muted">
        Allow spectators
        <input
          type="checkbox"
          checked={settings.allowSpectators}
          onChange={(event) => onChange({ ...settings, allowSpectators: event.target.checked })}
          className="h-4 w-4 accent-primary"
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-text-muted">
        Randomize colors
        <input
          type="checkbox"
          checked={settings.randomizeColors}
          onChange={(event) => onChange({ ...settings, randomizeColors: event.target.checked })}
          className="h-4 w-4 accent-primary"
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-text-muted">
        Disconnect grace
        <select
          value={settings.disconnectGraceMs}
          onChange={(event) => onChange({ ...settings, disconnectGraceMs: Number(event.target.value) })}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-text"
        >
          <option value={30_000}>30s</option>
          <option value={60_000}>60s</option>
          <option value={90_000}>90s</option>
          <option value={120_000}>120s</option>
        </select>
      </label>
    </Panel>
  );
}
