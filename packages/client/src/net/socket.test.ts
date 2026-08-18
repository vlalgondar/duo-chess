import { describe, expect, it } from 'vitest';
import { buildRoomUrl } from './socket.js';

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
