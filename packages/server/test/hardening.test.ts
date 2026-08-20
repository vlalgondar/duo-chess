import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestClient, type TestMessage } from './harness.js';

function chatText(m: TestMessage): string | undefined {
  return (m.message as { text?: string } | undefined)?.text;
}

function proposalSanIs(san: string) {
  return (m: TestMessage) => (m.proposal as { san?: string } | null)?.san === san;
}

describe('rate limiting (T-28)', () => {
  it('drops a 200-message burst without erroring the object, replying RATE_LIMITED for the excess', async () => {
    const room = await spawnRoom({ code: 'HD9AAA' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    // Fire all 200 essentially back-to-back — the whole burst lands inside
    // the rate limiter's 1s sliding window, so the first ~20 succeed and the
    // rest are dropped-and-warned, never crashing the object.
    for (let i = 0; i < 200; i++) {
      alice.send({ t: 'ping', ts: i });
    }

    // An early message is well inside the per-second cap.
    await alice.expect('pong', (m) => m.ts === 0);
    // A message past the cap is answered with a warning, not silence or a close.
    await alice.expect('error', (m) => m.code === 'RATE_LIMITED');
    // The last message of the burst never gets a reply — it was dropped, not just delayed.
    await alice.expectNever('pong', { within: 300, predicate: (m) => m.ts === 199 });

    // The socket is still open and the object still works normally — a
    // "dropped and warned" burst is not a disconnect or a crash.
    const snapshot = await room.debugState();
    expect(snapshot.socketCount).toBe(1);

    // Let the 1s sliding window fully clear the burst before proving normal
    // traffic resumes — otherwise a canary sent too soon just joins the tail
    // of the same rate-limited window.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    alice.send({ t: 'ping', ts: 12345 });
    await alice.expect('pong', (m) => m.ts === 12345, { timeout: 2_000 });

    alice.disconnect();
  });
});

describe('room expiry (T-28)', () => {
  it('expires an idle room after the configured window, wiping its state', async () => {
    const room = await spawnRoom({ code: 'HD9AAC' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    await room.setRoomExpiryMs(0);
    const ran = await room.advanceTo();
    expect(ran).toBe(true);

    const snapshot = await room.debugState();
    expect(snapshot.room).toBeNull();

    alice.disconnect();
  });

  it('a plain join to a code whose room just expired is rejected ROOM_NOT_FOUND', async () => {
    const room = await spawnRoom({ code: 'HD9AAD' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    await room.setRoomExpiryMs(0);
    await room.advanceTo();
    expect((await room.debugState()).room).toBeNull();

    alice.disconnect();

    // T-30: an expired room reads exactly like a code nobody ever created —
    // no `create` flag, no room, no silent resurrection.
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('error', (m) => m.code === 'ROOM_NOT_FOUND');
    expect((await room.debugState()).room).toBeNull();

    bob.disconnect();
  });

  it('a `create` join after expiry starts a brand-new room, ignoring the old resume token', async () => {
    const room = await spawnRoom({ code: 'HD9AAZ' });
    const alice = await room.connect({ username: 'alice' });
    // `resumeToken` only rides along on the `state` broadcast to the socket
    // that just (re)joined (§9) — capture it from alice's own 1-seat state,
    // before a second joiner's 2-seat broadcast (which carries no token for
    // alice at all) would otherwise be the first match.
    const joined = await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    const staleResumeToken = joined.resumeToken as string;
    expect(typeof staleResumeToken).toBe('string');
    const carol = await room.connect({ username: 'carol' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    await room.setRoomExpiryMs(0);
    await room.advanceTo();
    expect((await room.debugState()).room).toBeNull();

    alice.disconnect();
    carol.disconnect();

    // The stale token no longer resolves to anything (the room that issued
    // it is gone) — `handleJoin` falls through to a fresh join, exactly as
    // if this were a brand-new room for this code. Explicit `create: true`,
    // same as a client's own "Create Room" would send for an unknown code.
    const bob = await room.connect({ username: 'bob', resumeToken: staleResumeToken, create: true });
    const state = await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    expect((state.seats as Array<{ username: string }>)[0]?.username).toBe('bob');

    bob.disconnect();
  });
});

/**
 * The full-integration leak spec: a real 2v2 game to checkmate with a
 * spectator present throughout, where TEAM chat and board annotations are
 * exchanged at *every* half-move — not just once — so the `expectNever`
 * leak assertions on `proposal_update`, `annotation_update`, and TEAM
 * `chat_message` are exercised continuously across the whole game, on both
 * the opposing team's sockets and the spectator's, rather than a single
 * point-in-time check. Individual leak suites already exist per-feature
 * (T-20's `proposal.test.ts`, T-22's `annotations.test.ts`, T-23's
 * `spectators.test.ts`'s own full-game case) — this is the one place all
 * three run together, interleaved, for the whole game.
 */
describe('full-game integration leak spec (T-28)', () => {
  it('4 players + 1 spectator play a full 2v2 game to checkmate; no team-scoped message ever reaches an opponent or the spectator', async () => {
    const room = await spawnRoom({ code: 'HD9AAE' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE (alice's teammate)
    const dave = await room.connect({ username: 'dave' }); // BLACK (bob's teammate)
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' }); // 5th joiner -> spectator
    await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    // 1. f3 e5 2. g4 Qh4# — Fool's Mate. Before each half-move, the team
    // about to move exchanges one annotation and one TEAM chat message,
    // uniquely tagged by move index so `expectNever`'s predicate can't
    // false-positive on a *different* step's legitimate own-team traffic.
    const moves: Array<{
      proposer: TestClient;
      teammate: TestClient;
      opponents: readonly TestClient[];
      from: string;
      to: string;
      san: string;
      annotateSquare: string;
      chatText: string;
    }> = [
      {
        proposer: alice,
        teammate: carol,
        opponents: [bob, dave],
        from: 'f2',
        to: 'f3',
        san: 'f3',
        annotateSquare: 'a3',
        chatText: 'plan-1-go-f3',
      },
      {
        proposer: bob,
        teammate: dave,
        opponents: [alice, carol],
        from: 'e7',
        to: 'e5',
        san: 'e5',
        annotateSquare: 'a6',
        chatText: 'plan-2-go-e5',
      },
      {
        proposer: carol,
        teammate: alice,
        opponents: [bob, dave],
        from: 'g2',
        to: 'g4',
        san: 'g4',
        annotateSquare: 'b3',
        chatText: 'plan-3-go-g4',
      },
      {
        proposer: dave,
        teammate: bob,
        opponents: [alice, carol],
        from: 'd8',
        to: 'h4',
        san: 'Qh4#',
        annotateSquare: 'b6',
        chatText: 'plan-4-mate',
      },
    ];

    for (const { proposer, teammate, opponents, from, to, san, annotateSquare, chatText: text } of moves) {
      // Annotation: teammate sees it; both opponents and the spectator never do.
      proposer.send({ t: 'annotate', annotations: [{ kind: 'CIRCLE', from: annotateSquare, color: 'A' }] });
      const annotationMatches = (m: TestMessage) =>
        (m.annotations as Array<{ from: string }> | undefined)?.some((a) => a.from === annotateSquare) ?? false;
      await Promise.all([
        teammate.expect('annotation_update', annotationMatches),
        ...opponents.map((c) => c.expectNever('annotation_update', { within: 200, predicate: annotationMatches })),
        eve.expectNever('annotation_update', { within: 200, predicate: annotationMatches }),
      ]);

      // TEAM chat: same shape, scoped to this step's unique text.
      proposer.send({ t: 'chat', text, channel: 'TEAM' });
      const chatMatches = (m: TestMessage) => chatText(m) === text;
      await Promise.all([
        teammate.expect('chat_message', chatMatches),
        ...opponents.map((c) => c.expectNever('chat_message', { within: 200, predicate: chatMatches })),
        eve.expectNever('chat_message', { within: 200, predicate: chatMatches }),
      ]);

      // The move itself: propose -> proposal_update (teammate only) -> accept -> move_committed (everyone).
      proposer.send({ t: 'propose', from, to });
      const sanMatches = proposalSanIs(san);
      const [update] = await Promise.all([
        teammate.expect('proposal_update', sanMatches),
        proposer.expect('proposal_update', sanMatches),
        ...opponents.map((c) => c.expectNever('proposal_update', { within: 200, predicate: sanMatches })),
        eve.expectNever('proposal_update', { within: 200, predicate: sanMatches }),
      ]);
      const proposalId = (update.proposal as { id: string }).id;

      teammate.send({ t: 'accept', proposalId });
      await Promise.all(
        [alice, bob, carol, dave, eve].map((c) => c.expect('move_committed', (m) => m.san === san)),
      );
    }

    const gameOver = await eve.expect('game_over');
    expect(gameOver).toMatchObject({ status: 'CHECKMATE', winner: 'BLACK' });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('CHECKMATE');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });
});
