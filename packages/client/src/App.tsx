import { useRef, useState, type FormEvent } from 'react';
import { buildRoomUrl, connectSocket } from './net/socket.js';
import { useRoomStore } from './store.js';

const WS_BASE = import.meta.env.VITE_WS_URL;

/**
 * Real `state` messages (T-09) carry the full seat list on every join —
 * pull out usernames for the roster. This is throwaway scaffolding ahead of
 * the real Home/Lobby (T-10); it only needs to read the shape, not the
 * whole `ClientRoomView` contract.
 */
function parseRosterUsernames(data: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { t?: unknown }).t === 'state' &&
      Array.isArray((parsed as { seats?: unknown }).seats)
    ) {
      return (parsed as { seats: Array<{ username: string }> }).seats.map((seat) => seat.username);
    }
  } catch {
    return null;
  }
  return null;
}

export function App() {
  const status = useRoomStore((s) => s.status);
  const usernames = useRoomStore((s) => s.usernames);
  const setStatus = useRoomStore((s) => s.setStatus);
  const setUsernames = useRoomStore((s) => s.setUsernames);

  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [joined, setJoined] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedUsername || !trimmedCode) return;

    setStatus('connecting');
    setJoined(true);
    const url = buildRoomUrl(WS_BASE, trimmedCode);
    const ws = connectSocket(url, {
      onOpen: () => {
        setStatus('open');
        ws.send(JSON.stringify({ t: 'join', code: trimmedCode, username: trimmedUsername }));
      },
      onMessage: (data) => {
        const roster = parseRosterUsernames(data);
        if (roster) setUsernames(roster);
      },
      onClose: () => setStatus('closed'),
    });
    wsRef.current = ws;
  };

  if (!joined) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-100">
        <h1 className="text-2xl font-semibold">Duo Chess</h1>
        <form onSubmit={handleJoin} className="flex w-64 flex-col gap-3">
          <input
            data-testid="username-input"
            className="rounded bg-slate-800 px-3 py-2"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            data-testid="code-input"
            className="rounded bg-slate-800 px-3 py-2"
            placeholder="Room code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            data-testid="join-button"
            type="submit"
            className="rounded bg-emerald-600 px-3 py-2 font-medium"
          >
            Join
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">Duo Chess</h1>
      <p>
        Connection: <span data-testid="status">{status}</span>
      </p>
      <ul data-testid="roster" className="text-sm text-slate-300">
        {usernames.map((name) => (
          <li key={name} data-testid="roster-item">
            {name}
          </li>
        ))}
      </ul>
    </main>
  );
}
