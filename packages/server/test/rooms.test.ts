import { describe, expect, it } from 'vitest';
import { spawnRoom, type TestMessage } from './harness.js';

function seats(message: TestMessage): Array<{ username: string; connected: boolean }> {
  return Array.isArray(message.seats) ? (message.seats as Array<{ username: string; connected: boolean }>) : [];
}

function usernames(message: TestMessage): string[] {
  return seats(message)
    .map((s) => s.username)
    .sort();
}

describe('rooms in the Durable Object (T-09)', () => {
  it('three clients joining the same room all see each other', async () => {
    const room = await spawnRoom({ code: 'RM9AAA' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => usernames(m).length === 1);

    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => usernames(m).length === 2);

    const carol = await room.connect({ username: 'carol' });
    const final = await carol.expect('state', (m) => usernames(m).length === 3);
    expect(usernames(final)).toEqual(['alice', 'bob', 'carol']);

    // Everyone converges on the same three-seat roster, not just the latest joiner.
    const aliceFinal = await alice.expect('state', (m) => usernames(m).length === 3);
    const bobFinal = await bob.expect('state', (m) => usernames(m).length === 3);
    expect(usernames(aliceFinal)).toEqual(['alice', 'bob', 'carol']);
    expect(usernames(bobFinal)).toEqual(['alice', 'bob', 'carol']);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
  });

  it('a dropped client reconnecting with its resume token reclaims the same seat, without duplicating it', async () => {
    const room = await spawnRoom({ code: 'RM9AAB' });
    let alice = await room.connect({ username: 'alice' });
    const joined = await alice.expect('state', (m) => usernames(m).length === 1);
    const resumeToken = joined.resumeToken as string;
    expect(typeof resumeToken).toBe('string');

    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => usernames(m).length === 2);

    alice.disconnect();
    const afterDrop = await bob.expect(
      'state',
      (m) => seats(m).find((s) => s.username === 'alice')?.connected === false,
    );
    expect(usernames(afterDrop)).toEqual(['alice', 'bob']); // still 2 seats — the seat isn't removed on disconnect

    alice = await room.connect({ username: 'alice', resumeToken });
    const afterResume = await bob.expect(
      'state',
      (m) => seats(m).find((s) => s.username === 'alice')?.connected === true,
    );
    expect(usernames(afterResume)).toEqual(['alice', 'bob']); // still exactly 2 — no duplicate seat

    alice.disconnect();
    bob.disconnect();
  });

  it('room state survives a forced Durable Object reset', async () => {
    const room = await spawnRoom({ code: 'RM9AAC' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => usernames(m).length === 1);
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => usernames(m).length === 2);

    await room.forceReset();

    const survived = await room.debugState();
    expect(survived.room?.seats.map((s) => s.username).sort()).toEqual(['alice', 'bob']);

    // The room still works after rehydration: a third joiner is seen by everyone.
    const carol = await room.connect({ username: 'carol' });
    const final = await carol.expect('state', (m) => usernames(m).length === 3);
    expect(usernames(final)).toEqual(['alice', 'bob', 'carol']);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
  });
});

describe('create vs. join (T-30)', () => {
  it('a plain join to a code with no live room is rejected ROOM_NOT_FOUND, and creates nothing', async () => {
    const room = await spawnRoom({ code: 'RM9AAD' });
    const alice = await room.connect({ username: 'alice', create: false });
    await alice.expect('error', (m) => m.code === 'ROOM_NOT_FOUND');
    expect((await room.debugState()).room).toBeNull();
    alice.disconnect();
  });

  it('a join with create: true against an unknown code stands up a fresh room, joiner as host', async () => {
    const room = await spawnRoom({ code: 'RM9AAE' });
    const alice = await room.connect({ username: 'alice', create: true });
    const state = await alice.expect('state', (m) => usernames(m).length === 1);
    expect((state.seats as Array<{ username: string; isHost: boolean }>)[0]).toMatchObject({
      username: 'alice',
      isHost: true,
    });
    alice.disconnect();
  });

  it('create: true against a code that already has a live room is rejected ROOM_CODE_TAKEN, room unchanged', async () => {
    const room = await spawnRoom({ code: 'RM9AAF' });
    const alice = await room.connect({ username: 'alice', create: true });
    await alice.expect('state', (m) => usernames(m).length === 1);

    const bob = await room.connect({ username: 'bob', create: true });
    await bob.expect('error', (m) => m.code === 'ROOM_CODE_TAKEN');

    expect((await room.debugState()).room?.seats.map((s) => s.username)).toEqual(['alice']);
    alice.disconnect();
    bob.disconnect();
  });
});
