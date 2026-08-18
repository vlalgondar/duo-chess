import { useState } from 'react';
import type { ClientRoomView, RoomSettings } from '@duo/shared';

// docs/DESIGN.md §5.3 gates Start on "every player has picked a team", but
// team assignment happens on the later Team Select screen (§5.4) per the
// §5.1 screen map — no seat has a team yet while still in the Lobby. Gating
// on player count alone, per this task's own e2e spec; see TASKS.md Findings
// (the §5.3/§5.4 disagreement) for the team-size gating still owed at T-17.
const MIN_PLAYERS_TO_START = 2;

interface LobbyProps {
  view: ClientRoomView;
  onStart: () => void;
  onUpdateSettings: (settings: RoomSettings) => void;
}

export function Lobby({ view, onStart, onUpdateSettings }: LobbyProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const isHost = you?.isHost ?? false;
  const canStart = view.seats.length >= MIN_PLAYERS_TO_START;
  const joinLink = `${window.location.origin}/join/${view.code}`;

  return (
    <main className="flex min-h-dvh flex-col items-center gap-8 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Duo Chess</h1>

      <section className="flex flex-col items-center gap-2">
        <p
          data-testid="room-code"
          className="rounded bg-slate-800 px-4 py-2 font-mono text-2xl tracking-[0.3em]"
        >
          {view.code}
        </p>
        <CopyLinkButton link={joinLink} />
      </section>

      <ul data-testid="roster" className="flex w-64 flex-col gap-2">
        {view.seats.map((seat) => (
          <li
            key={seat.publicId}
            data-testid="roster-item"
            className="flex items-center gap-2 rounded bg-slate-900 px-3 py-2"
          >
            <span
              data-testid="connection-dot"
              data-connected={seat.connected}
              className={`h-2.5 w-2.5 rounded-full ${seat.connected ? 'bg-emerald-500' : 'bg-slate-600'}`}
            />
            <span>{seat.username}</span>
            {seat.isHost && <span className="text-xs text-slate-400">(host)</span>}
          </li>
        ))}
      </ul>

      {isHost ? (
        <HostSettings settings={view.settings} onChange={onUpdateSettings} />
      ) : (
        <p className="text-sm text-slate-400">Time control: {view.settings.timeControl.label}</p>
      )}

      {isHost ? (
        <button
          data-testid="start-button"
          type="button"
          disabled={!canStart}
          onClick={onStart}
          className="w-64 rounded bg-emerald-600 px-4 py-3 text-lg font-semibold disabled:opacity-50"
        >
          Start
        </button>
      ) : (
        <p className="text-sm text-slate-400">Waiting for the host to start…</p>
      )}
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
    <button
      data-testid="copy-link-button"
      type="button"
      onClick={handleCopy}
      className="text-sm text-emerald-400 underline"
    >
      {copied ? 'Copied!' : 'Copy invite link'}
    </button>
  );
}

/**
 * `timeControl` is deliberately read-only here — the full 10-option picker
 * (§1.1) is T-16's job. `allowSpectators`/`randomizeColors`/`disconnectGraceMs`
 * have no later task claiming them, so they're wired live. The server doesn't
 * yet handle `update_settings` (T-09's Findings; lands at T-17 alongside
 * `set_team`), so a host edit here is a no-op until then.
 */
function HostSettings({
  settings,
  onChange,
}: {
  settings: RoomSettings;
  onChange: (settings: RoomSettings) => void;
}) {
  return (
    <section data-testid="host-settings" className="flex w-64 flex-col gap-3 rounded bg-slate-900 p-4 text-sm">
      <p className="text-slate-400">Time control: {settings.timeControl.label}</p>

      <label className="flex items-center justify-between gap-2">
        Allow spectators
        <input
          type="checkbox"
          checked={settings.allowSpectators}
          onChange={(event) => onChange({ ...settings, allowSpectators: event.target.checked })}
        />
      </label>

      <label className="flex items-center justify-between gap-2">
        Randomize colors
        <input
          type="checkbox"
          checked={settings.randomizeColors}
          onChange={(event) => onChange({ ...settings, randomizeColors: event.target.checked })}
        />
      </label>

      <label className="flex items-center justify-between gap-2">
        Disconnect grace
        <select
          value={settings.disconnectGraceMs}
          onChange={(event) => onChange({ ...settings, disconnectGraceMs: Number(event.target.value) })}
          className="rounded bg-slate-800 px-2 py-1"
        >
          <option value={30_000}>30s</option>
          <option value={60_000}>60s</option>
          <option value={90_000}>90s</option>
          <option value={120_000}>120s</option>
        </select>
      </label>
    </section>
  );
}
