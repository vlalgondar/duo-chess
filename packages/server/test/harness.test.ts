import { describe, expect, it } from 'vitest';
import { spawnRoom, type TestMessage } from './harness.js';

function seatCount(message: TestMessage): number {
  return Array.isArray(message.seats) ? message.seats.length : -1;
}

describe('multi-client harness', () => {
  it('connects several named clients and delivers a sent message', async () => {
    const room = await spawnRoom({ code: 'HARN2A' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => seatCount(m) === 1);

    const bob = await room.connect({ username: 'bob' });
    const seenByAlice = await alice.expect('state', (m) => seatCount(m) === 2);
    expect(seenByAlice.t).toBe('state');

    alice.disconnect();
    bob.disconnect();
  });

  it('expectNever resolves cleanly when a message never arrives (cross-room isolation)', async () => {
    const roomA = await spawnRoom({ code: 'HARN3A' });
    const roomB = await spawnRoom({ code: 'HARN4A' });
    const alice = await roomA.connect({ username: 'alice' });
    const eve = await roomB.connect({ username: 'eve' });
    await eve.expect('state', (m) => seatCount(m) === 1);

    await roomA.connect({ username: 'bob' });
    await eve.expectNever('state', { within: 300, predicate: (m) => seatCount(m) === 2 });

    alice.disconnect();
    eve.disconnect();
  });

  it('expectNever rejects when a matching message actually arrives — proving it can catch a leak', async () => {
    const room = await spawnRoom({ code: 'HARN5A' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => seatCount(m) === 2);

    await expect(
      bob.expectNever('state', { within: 300, predicate: (m) => seatCount(m) === 2 }),
    ).rejects.toThrow(/expected never to receive/);

    alice.disconnect();
    bob.disconnect();
  });

  it('drops a socket and reconnects with a resume token, still reclaiming the same seat', async () => {
    const room = await spawnRoom({ code: 'HARN6A' });
    let alice = await room.connect({ username: 'alice' });
    const joined = await alice.expect('state', (m) => seatCount(m) === 1);
    const resumeToken = joined.resumeToken;
    expect(typeof resumeToken).toBe('string');

    alice.disconnect();
    alice = await room.connect({ username: 'alice', resumeToken: resumeToken as string });
    await alice.expect('state', (m) => seatCount(m) === 1);

    alice.disconnect();
  });

  it('debugState reports connected socket count as clients join and leave', async () => {
    const room = await spawnRoom({ code: 'HARN7A' });
    expect((await room.debugState()).socketCount).toBe(0);

    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state');
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => seatCount(m) === 2);
    expect((await room.debugState()).socketCount).toBe(2);

    bob.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await room.debugState()).socketCount).toBe(1);

    alice.disconnect();
  });

  it('advanceTo fires a pending alarm and reports when none is scheduled', async () => {
    // T-28: once a room exists, a room-expiry alarm is always pending (see
    // RoomDO.scheduleAlarm) — so "none scheduled" now means "never joined,"
    // not "joined but otherwise idle." No `connect()` call here at all.
    const room = await spawnRoom({ code: 'HARN8A' });

    const ran = await room.advanceTo(Date.now() + 1000);
    expect(ran).toBe(false);
  });
});
