import { describe, expect, it } from 'vitest';
import { startOneVOneGame, startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestMessage } from './harness.js';

type PendingVote = { kind: string; initiator: string; agreedSeats: string[] };

function pendingVotesOf(state: TestMessage): PendingVote[] {
  const game = state.game as { pendingVotes?: PendingVote[] } | undefined;
  return game?.pendingVotes ?? [];
}

describe('team votes (T-25 §4.5)', () => {
  it('a solo team (1v1) resigns immediately — no pending vote, opponent wins', async () => {
    const room = await spawnRoom({ code: 'GM9AVA' });
    const alice = await room.connect({ username: 'alice' }); // WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    await startOneVOneGame(alice, bob);

    alice.send({ t: 'vote', kind: 'RESIGN' });
    const gameOver = await bob.expect('game_over');
    expect(gameOver).toMatchObject({ status: 'RESIGNED', winner: 'BLACK' });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('RESIGNED');
    expect(snapshot.room?.game?.pendingVotes).toEqual([]);

    alice.disconnect();
    bob.disconnect();
  });

  it('a one-sided 2v2 resign is recorded but does not end the game', async () => {
    const room = await spawnRoom({ code: 'GM9AVB' });
    const alice = await room.connect({ username: 'alice' }); // WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await startTwoVTwoGame({ alice, bob, carol, dave });

    alice.send({ t: 'vote', kind: 'RESIGN' });
    const state = await alice.expect('state', (m) => pendingVotesOf(m).length === 1);
    expect(pendingVotesOf(state)).toEqual([
      { kind: 'RESIGN', initiator: 'WHITE', agreedSeats: [expect.any(String)], expiresAt: expect.any(Number) },
    ]);

    await Promise.all([bob, carol, dave].map((c) => c.expectNever('game_over', { within: 200 })));

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('ACTIVE');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it('both teammates resigning ends a 2v2 game, opponents win', async () => {
    const room = await spawnRoom({ code: 'GM9AVC' });
    const alice = await room.connect({ username: 'alice' }); // WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await startTwoVTwoGame({ alice, bob, carol, dave });

    alice.send({ t: 'vote', kind: 'RESIGN' });
    await alice.expect('state', (m) => pendingVotesOf(m).length === 1);

    carol.send({ t: 'vote', kind: 'RESIGN' });
    const gameOvers = await Promise.all(
      [alice, bob, carol, dave].map((c) => c.expect('game_over')),
    );
    for (const gameOver of gameOvers) {
      expect(gameOver).toMatchObject({ status: 'RESIGNED', winner: 'BLACK' });
    }

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.pendingVotes).toEqual([]);
    expect(snapshot.room?.game?.clock.running).toBe(false);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it('a draw offer, agreed by both teammates, goes to the opponents and both accepting ends the game in a draw', async () => {
    const room = await spawnRoom({ code: 'GM9AVD' });
    const alice = await room.connect({ username: 'alice' }); // WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await startTwoVTwoGame({ alice, bob, carol, dave });

    alice.send({ t: 'vote', kind: 'DRAW_OFFER' });
    await alice.expect('state', (m) => pendingVotesOf(m).length === 1);
    carol.send({ t: 'vote', kind: 'DRAW_OFFER' });
    const offered = await bob.expect(
      'state',
      (m) => (m.game as { drawOffer?: { by?: string } } | undefined)?.drawOffer?.by === 'WHITE',
    );
    expect(pendingVotesOf(offered)).toEqual([]);

    // Both BLACK teammates must accept (§4.5) — the DO processes each vote
    // independently of arrival order, so the final `game_over` below (which
    // could only happen once *both* have agreed) is the real proof, not an
    // intermediate `state` check on either socket's own message buffer.
    bob.send({ t: 'vote', kind: 'DRAW_ACCEPT' });
    dave.send({ t: 'vote', kind: 'DRAW_ACCEPT' });

    const gameOvers = await Promise.all([alice, bob, carol, dave].map((c) => c.expect('game_over')));
    for (const gameOver of gameOvers) {
      expect(gameOver).toMatchObject({ status: 'DRAW', winner: null });
    }

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.drawOffer).toBeNull();

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it('DRAW_ACCEPT with no live offer is rejected, and TAKEBACK is refused outright', async () => {
    const room = await spawnRoom({ code: 'GM9AVE' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await startOneVOneGame(alice, bob);

    alice.send({ t: 'vote', kind: 'DRAW_ACCEPT', nonce: 'n1' });
    const noOffer = await alice.expect('error', (m) => m.nonce === 'n1');
    expect(noOffer.code).toBe('NO_DRAW_OFFER');

    alice.send({ t: 'vote', kind: 'TAKEBACK', nonce: 'n2' });
    const unsupported = await alice.expect('error', (m) => m.nonce === 'n2');
    expect(unsupported.code).toBe('VOTE_NOT_SUPPORTED');

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('ACTIVE');

    alice.disconnect();
    bob.disconnect();
  });

  it('an unresolved vote expires after its window, clearing the slot, via a genuine unforced alarm firing', async () => {
    const room = await spawnRoom({ code: 'GM9AVF' });
    const alice = await room.connect({ username: 'alice' }); // WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await startTwoVTwoGame({ alice, bob, carol, dave });

    await room.setVoteExpiryMs(300);

    alice.send({ t: 'vote', kind: 'RESIGN' });
    await alice.expect('state', (m) => pendingVotesOf(m).length === 1);

    // A real, unforced wait past the (shortened, test-only) 300ms expiry
    // window — same "genuine firing, not `advanceTo()`-forced" precedent
    // T-16's flag-fall test set, since `alarm()`'s own deadline check is
    // `now >= expiresAt` against the real wall clock either way.
    await new Promise((resolve) => setTimeout(resolve, 800));

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('ACTIVE');
    expect(snapshot.room?.game?.pendingVotes).toEqual([]);

    // The slot is free again — a fresh resign vote from carol starts its own
    // window, not a leftover agreement from the expired one (only carol has
    // agreed, not alice, so it must not resolve).
    carol.send({ t: 'vote', kind: 'RESIGN' });
    await Promise.all([alice, bob, dave].map((c) => c.expectNever('game_over', { within: 200 })));

    const afterCarolVotes = await room.debugState();
    const carolSeatId = afterCarolVotes.room?.seats.find((s) => s.username === 'carol')?.seatId;
    expect(afterCarolVotes.room?.game?.pendingVotes).toEqual([
      { kind: 'RESIGN', initiator: 'WHITE', agreedSeats: new Set([carolSeatId]), expiresAt: expect.any(Number) },
    ]);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });
});
