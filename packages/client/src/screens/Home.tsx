import { useEffect, useState, type FormEvent } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@duo/shared';

const USERNAME_STORAGE_KEY = 'duo-chess:username';
const JOIN_PATH_PATTERN = /^\/join\/([^/]+)\/?$/i;
const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 16;

/** Uppercases and drops any character outside the room-code alphabet — keeps the code input paste-friendly. */
function sanitizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .slice(0, ROOM_CODE_LENGTH)
    .join('');
}

/** `docs/DESIGN.md` §5.2 deep link: `/join/:code` prefills the code field. */
function readDeepLinkCode(): string | null {
  const match = JOIN_PATH_PATTERN.exec(window.location.pathname);
  const rawCode = match?.[1];
  if (!rawCode) return null;
  const code = sanitizeCode(rawCode);
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

interface HomeProps {
  onCreate: (username: string) => void;
  onJoin: (username: string, code: string) => void;
  joinError: string | null;
  busy: boolean;
}

export function Home({ onCreate, onJoin, joinError, busy }: HomeProps) {
  const [username, setUsername] = useState(
    () => window.localStorage.getItem(USERNAME_STORAGE_KEY) ?? '',
  );
  const [code, setCode] = useState(() => readDeepLinkCode() ?? '');

  useEffect(() => {
    // Deep link consumed into `code` above; drop it from the URL so a later
    // "Create Room" doesn't leave a stale /join/:code in the address bar.
    if (readDeepLinkCode()) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const trimmedUsername = username.trim();
  const usernameValid =
    trimmedUsername.length >= USERNAME_MIN_LENGTH && trimmedUsername.length <= USERNAME_MAX_LENGTH;
  const codeValid = code.length === ROOM_CODE_LENGTH;

  const persistUsername = () => {
    window.localStorage.setItem(USERNAME_STORAGE_KEY, trimmedUsername);
  };

  const handleCreate = () => {
    if (!usernameValid || busy) return;
    persistUsername();
    onCreate(trimmedUsername);
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!usernameValid || !codeValid || busy) return;
    persistUsername();
    onJoin(trimmedUsername, code);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-3xl font-semibold">Duo Chess</h1>

      <input
        data-testid="username-input"
        className="w-64 rounded bg-slate-800 px-3 py-2"
        placeholder="Username"
        value={username}
        maxLength={USERNAME_MAX_LENGTH}
        onChange={(event) => setUsername(event.target.value)}
      />

      <button
        data-testid="create-room-button"
        type="button"
        disabled={!usernameValid || busy}
        onClick={handleCreate}
        className="w-64 rounded bg-emerald-600 px-4 py-3 text-lg font-semibold disabled:opacity-50"
      >
        Create Room
      </button>

      <form onSubmit={handleJoin} className="flex w-64 flex-col gap-3 border-t border-slate-800 pt-6">
        <input
          data-testid="code-input"
          className="rounded bg-slate-800 px-3 py-2 text-center uppercase tracking-widest"
          placeholder="Room code"
          value={code}
          onChange={(event) => setCode(sanitizeCode(event.target.value))}
          onPaste={(event) => {
            event.preventDefault();
            setCode(sanitizeCode(event.clipboardData.getData('text')));
          }}
          maxLength={ROOM_CODE_LENGTH}
        />
        <button
          data-testid="join-button"
          type="submit"
          disabled={!usernameValid || !codeValid || busy}
          className="rounded bg-slate-700 px-3 py-2 font-medium disabled:opacity-50"
        >
          Join
        </button>
      </form>

      {joinError && (
        <p data-testid="join-error" className="w-64 text-center text-sm text-red-400">
          {joinError}
        </p>
      )}
    </main>
  );
}
