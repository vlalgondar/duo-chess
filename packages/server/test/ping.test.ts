import { describe, expect, it } from 'vitest';
import { spawnRoom } from './harness.js';

describe('ping/pong RTT measurement (T-27)', () => {
  it('replies to a ping with a pong echoing the same ts plus the server clock', async () => {
    const room = await spawnRoom({ code: 'PNGABC' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state');

    alice.send({ t: 'ping', ts: 12345 });
    const pong = await alice.expect('pong');

    expect(pong.ts).toBe(12345);
    expect(typeof pong.serverNow).toBe('number');

    alice.disconnect();
  });

  it('replies only to the requesting socket, not the whole room', async () => {
    const room = await spawnRoom({ code: 'PNGABD' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'ping', ts: 999 });
    await alice.expect('pong', (m) => m.ts === 999);
    await bob.expectNever('pong', { within: 200 });

    alice.disconnect();
    bob.disconnect();
  });

  it('does not advance seq or otherwise touch persisted room state', async () => {
    const room = await spawnRoom({ code: 'PNGABE' });
    const alice = await room.connect({ username: 'alice' });
    const before = await alice.expect('state');

    alice.send({ t: 'ping', ts: 1 });
    await alice.expect('pong');

    // A ping must not itself trigger a fresh broadcastState — proven by
    // asserting no further "state" ever arrives from it alone.
    await alice.expectNever('state', { within: 200, predicate: (m) => (m.seq as number) > (before.seq as number) });

    alice.disconnect();
  });
});
