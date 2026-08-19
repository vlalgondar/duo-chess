import type { ClientMessage } from '@duo/shared';

/** Joins a base `VITE_WS_URL` (e.g. `wss://host/ws`) with a room code, per docs/DESIGN.md §12. */
export function buildRoomUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/${code}`;
}

/** §9's reconnect loop: "exponential backoff (250ms → 500ms → 1s → 2s → 5s cap)". */
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];

/** `attempt` is 0-indexed (the first retry after a drop); every attempt past the table's end stays capped at 5s. */
export function reconnectDelayMs(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
}

const SESSION_STORAGE_KEY = 'duo-chess:session';

interface StoredSession {
  code: string;
  username: string;
  resumeToken: string;
}

/**
 * §9: "On join, the server issues an opaque `resumeToken` stored in
 * `sessionStorage`... This handles refreshes, tab switches on mobile, and
 * brief network drops." Kept here, not in `store.ts`, since it's a browser-
 * storage side effect rather than in-memory room state.
 */
export function saveSession(session: StoredSession): void {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): StoredSession | null {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredSession).code === 'string' &&
      typeof (parsed as StoredSession).username === 'string' &&
      typeof (parsed as StoredSession).resumeToken === 'string'
    ) {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * §5.7's `leave`: the seat is gone server-side, so the token must not survive to let
 * `App.tsx`'s auto-resume effect rejoin on the next page load.
 */
export function clearSession(): void {
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export interface SocketHandlers {
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
}

export function connectSocket(url: string, handlers: SocketHandlers): WebSocket {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => handlers.onOpen?.());
  ws.addEventListener('message', (event) => {
    handlers.onMessage?.(typeof event.data === 'string' ? event.data : '');
  });
  ws.addEventListener('close', () => handlers.onClose?.());
  return ws;
}

/** The one place a client message is serialized — mirrors `redactFor()` being the one place a room is. */
export function sendMessage(ws: WebSocket, message: ClientMessage): void {
  ws.send(JSON.stringify(message));
}
