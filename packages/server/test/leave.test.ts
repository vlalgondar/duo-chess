import { describe, expect, it } from 'vitest';
import { startOneVOneGame } from './gameSetup.js';
import { spawnRoom, type TestMessage } from './harness.js';

describe('leave (§5.7)', () => {
  it('a non-host leaving in LOBBY frees the seat for everyone else', async () => {
    const room = await spawnRoom({ code: 'LV9AAA' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);

    bob.send({ t: 'leave' });
    // Not just "bob absent" — alice's own buffer already contains the 1-seat state
    // from right after her own join (vacuously bob-free), and `TestClient.expect`
    // matches against the whole buffer, not just messages received after this call.
    // Pin down the exact expected shape: 2 seats, bob gone, carol still there.
    const twoSeatsNoBob = (m: TestMessage) =>
      Array.isArray(m.seats) && m.seats.length === 2 && (m.seats as Array<{ username: string }>).every((s) => s.username !== 'bob');
    const state = await alice.expect('state', twoSeatsNoBob);
    expect((state.seats as Array<{ username: string }>).map((s) => s.username)).toEqual(['alice', 'carol']);
    await carol.expect('state', twoSeatsNoBob);

    const snapshot = await room.debugState();
    expect(snapshot.room?.seats.length).toBe(2);

    alice.disconnect();
    carol.disconnect();
  });

  it('the host leaving promotes the earliest remaining seat, and the room keeps working', async () => {
    const room = await spawnRoom({ code: 'LV9AAB' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'leave' });
    const state = await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    expect(state.seats).toEqual([expect.objectContaining({ username: 'bob', isHost: true })]);

    // The new host's own host-only action works — the room isn't just left in a
    // headless state.
    bob.send({ t: 'update_settings', settings: { ...(state.settings as object), allowSpectators: false } });
    await bob.expect('state', (m) => (m.settings as { allowSpectators: boolean }).allowSpectators === false);

    bob.disconnect();
  });

  it('leave during IN_GAME is rejected — resign instead', async () => {
    const room = await spawnRoom({ code: 'LV9AAC' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await startOneVOneGame(alice, bob);

    alice.send({ t: 'leave', nonce: 'n1' });
    const error = await alice.expect('error', (m) => m.nonce === 'n1');
    expect(error.code).toBe('INVALID_PHASE');

    const snapshot = await room.debugState();
    expect(snapshot.room?.seats.length).toBe(2);

    alice.disconnect();
    bob.disconnect();
  });

  it('leave works in TEAM_SELECT and in FINISHED', async () => {
    const room = await spawnRoom({ code: 'LV9AAD' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);

    alice.send({ t: 'start_game' });
    await Promise.all(
      [alice, bob, carol].map((c) => c.expect('state', (m) => m.phase === 'TEAM_SELECT')),
    );

    carol.send({ t: 'leave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2 && m.phase === 'TEAM_SELECT');

    // Reach FINISHED via the real T-25 resign path (solo team, immediate).
    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    alice.send({ t: 'set_ready', ready: true });
    bob.send({ t: 'set_ready', ready: true });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT' && (m.seats as Array<{ ready: boolean }>).every((s) => s.ready));
    alice.send({ t: 'start_game' });
    await Promise.all([alice, bob].map((c) => c.expect('state', (m) => m.phase === 'IN_GAME')));

    alice.send({ t: 'vote', kind: 'RESIGN' });
    await Promise.all([alice, bob].map((c) => c.expect('game_over')));
    await alice.expect('state', (m) => m.phase === 'FINISHED');

    bob.send({ t: 'leave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1 && m.phase === 'FINISHED');

    alice.disconnect();
  });

  it('a stale resumeToken after leaving does not reclaim the old seat — it is a fresh join', async () => {
    const room = await spawnRoom({ code: 'LV9AAE' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const bobState = await bob.expect('state', (m) => typeof m.resumeToken === 'string');
    const bobToken = bobState.resumeToken as string;
    const bobOriginalId = bobState.you as string;

    bob.send({ t: 'leave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    const rejoined = await room.connect({ username: 'bob', resumeToken: bobToken });
    const rejoinedState = await rejoined.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    expect(rejoinedState.you).not.toBe(bobOriginalId);
    expect((rejoinedState.seats as Array<{ username: string; isHost: boolean }>).find((s) => s.username === 'bob')?.isHost).toBe(
      false,
    );

    alice.disconnect();
    rejoined.disconnect();
  });

  it("the leaver's resume token is pruned", async () => {
    const room = await spawnRoom({ code: 'LV9AAF' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    const before = await room.debugState();
    bob.send({ t: 'leave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    const after = await room.debugState();
    expect(after.resumeTokenCount).toBe(before.resumeTokenCount - 1);

    alice.disconnect();
  });

  it('the last seat leaving wipes the room; the next join on the same code starts fresh', async () => {
    const room = await spawnRoom({ code: 'LV9AAG' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    alice.send({ t: 'leave' });
    // No one is left to assert a `state` on — poll `debugState()` instead, same
    // pattern the existing T-28 room-expiry test uses. Deliberately not also
    // asserting `socketCount === 0`: `expireRoom()`'s close is server-initiated, and
    // in this test pool a socket's close handshake only completes once the *other*
    // end (the test's own client-side socket) processes it — which nothing here ever
    // does, since alice never calls `.disconnect()` herself. T-28's own room-expiry
    // test (`hardening.test.ts`) makes the same call, checking only `room`.
    await expect.poll(async () => (await room.debugState()).room, { timeout: 1000 }).toBeNull();

    const fresh = await room.connect({ username: 'dave' });
    const state = await fresh.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    expect(state.seats).toEqual([expect.objectContaining({ username: 'dave', isHost: true })]);

    fresh.disconnect();
  });

  it('a second leave on an already-left socket does not crash the room', async () => {
    const room = await spawnRoom({ code: 'LV9AAH' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    bob.send({ t: 'leave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    // The server already closed bob's socket in response to the first `leave`
    // (`handleLeave` clears the attachment, then `ws.close()`s it). A second message
    // racing that close handshake must not crash the object — this is what
    // `sendError`'s `isSocketOpen` guard (added alongside this feature) exists for.
    // Whether the client-side socket itself still accepts a `.send()` during that
    // window is a workerd implementation detail, not something this test asserts.
    try {
      bob.send({ t: 'leave' });
    } catch {
      // A synchronous throw from an already-closing client socket is an acceptable
      // outcome here — the point is that the *room* survives either way.
    }

    // The room is still healthy for everyone else — no uncaught exception tore down
    // the object (which would otherwise surface as this next round-trip failing).
    alice.send({ t: 'ping', ts: 1 });
    await alice.expect('pong');

    alice.disconnect();
  });

  it('a departed seat frees a slot a spectator can be promoted into (closing the T-23 loop)', async () => {
    const room = await spawnRoom({ code: 'LV9AAJ' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' });
    await alice.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    dave.send({ t: 'leave' });
    // Not just "3 seats, dave absent" — alice's buffer already has exactly that shape
    // from right after carol (but before dave) joined. Also require eve's spectator
    // count, which is only true from eve's join onward — that pins down the state to
    // strictly after dave's departure, since it can't co-occur with the earlier one.
    await alice.expect(
      'state',
      (m) =>
        Array.isArray(m.seats) &&
        m.seats.length === 3 &&
        (m.seats as Array<{ username: string }>).every((s) => s.username !== 'dave') &&
        Array.isArray(m.spectators) &&
        m.spectators.length === 1,
    );

    const eveState = await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    const evePublicId = (eveState.spectators as Array<{ publicId: string; username: string }>).find(
      (s) => s.username === 'eve',
    )?.publicId;
    if (!evePublicId) throw new Error('eve not found in spectators');

    alice.send({ t: 'promote_spectator', publicId: evePublicId, team: 'BLACK' });
    // Not just `seats.length === 4` — the very first state alice ever saw (dave still
    // seated, before he left) already has that shape. Require eve specifically.
    const promoted = await alice.expect(
      'state',
      (m) =>
        Array.isArray(m.seats) &&
        m.seats.length === 4 &&
        (m.seats as Array<{ username: string }>).some((s) => s.username === 'eve'),
    );
    expect((promoted.seats as Array<{ username: string }>).map((s) => s.username)).toContain('eve');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    eve.disconnect();
  });
});
