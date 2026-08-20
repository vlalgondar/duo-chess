import { useEffect, useState, type FormEvent } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@duo/shared';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Panel } from '../ui/Panel.js';
import { Crown } from '../ui/Icon.js';

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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-text">
          <Crown className="h-7 w-7 text-accent" aria-hidden="true" />
          Duo Chess
        </div>
        <p className="text-sm text-text-muted">2v2 online chess — propose, agree, move.</p>
      </div>

      <Panel className="flex w-full max-w-sm flex-col gap-4 p-5">
        <Field
          data-testid="username-input"
          label="Your name"
          placeholder="e.g. alice"
          value={username}
          maxLength={USERNAME_MAX_LENGTH}
          onChange={(event) => setUsername(event.target.value)}
        />

        <Button
          data-testid="create-room-button"
          variant="primary"
          size="lg"
          disabled={!usernameValid || busy}
          onClick={handleCreate}
          className="w-full"
        >
          Create Room
        </Button>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-text-dim">
          <span className="h-px flex-1 bg-line" />
          or join a room
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <Field
            data-testid="code-input"
            label="Room code"
            placeholder="K7P2QX"
            value={code}
            onChange={(event) => setCode(sanitizeCode(event.target.value))}
            onPaste={(event) => {
              event.preventDefault();
              setCode(sanitizeCode(event.clipboardData.getData('text')));
            }}
            maxLength={ROOM_CODE_LENGTH}
            className="text-center font-mono text-lg uppercase tracking-[0.3em]"
          />
          <Button
            data-testid="join-button"
            type="submit"
            variant="secondary"
            disabled={!usernameValid || !codeValid || busy}
            className="w-full"
          >
            Join room
          </Button>
        </form>

        {joinError && (
          <p data-testid="join-error" role="alert" className="text-center text-sm text-danger-hi">
            {joinError}
          </p>
        )}
      </Panel>
    </main>
  );
}
