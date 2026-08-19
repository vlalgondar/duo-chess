import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoomUrl, loadSession, reconnectDelayMs, saveSession } from './socket.js';

/**
 * The package's vitest project runs under plain Node (no DOM), so there's no
 * real `window`/`sessionStorage` to test against — `saveSession`/`loadSession`
 * are the only code in this package that touch either. A tiny in-memory
 * stand-in is enough to exercise the actual read/write/parse logic without
 * adding a `jsdom` dependency (CLAUDE.md: ask before adding one) for a single
 * test file.
 */
function stubSessionStorage(): Storage {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
    clear: () => backing.clear(),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage;
  vi.stubGlobal('window', { sessionStorage: storage });
  return storage;
}

describe('buildRoomUrl', () => {
  it('joins a base url and a room code', () => {
    expect(buildRoomUrl('ws://localhost:8787/ws', 'K7P2QX')).toBe(
      'ws://localhost:8787/ws/K7P2QX',
    );
  });

  it('trims a trailing slash on the base before joining', () => {
    expect(buildRoomUrl('wss://duo-chess.example.workers.dev/ws/', 'K7P2QX')).toBe(
      'wss://duo-chess.example.workers.dev/ws/K7P2QX',
    );
  });
});

describe('reconnectDelayMs', () => {
  it('follows §9\'s 250ms -> 500ms -> 1s -> 2s -> 5s-cap backoff table', () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelayMs)).toEqual([250, 500, 1000, 2000, 5000]);
  });

  it('stays capped at 5s for any attempt past the table', () => {
    expect(reconnectDelayMs(5)).toBe(5000);
    expect(reconnectDelayMs(100)).toBe(5000);
  });
});

describe('session storage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = stubSessionStorage();
  });

  it('round-trips a saved session', () => {
    expect(loadSession()).toBeNull();

    saveSession({ code: 'K7P2QX', username: 'alice', resumeToken: 'tok-1' });
    expect(loadSession()).toEqual({ code: 'K7P2QX', username: 'alice', resumeToken: 'tok-1' });
  });

  it('ignores malformed stored data rather than throwing', () => {
    storage.setItem('duo-chess:session', '{not json');
    expect(loadSession()).toBeNull();

    storage.setItem('duo-chess:session', JSON.stringify({ code: 'K7P2QX' }));
    expect(loadSession()).toBeNull();
  });
});
