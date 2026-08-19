import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestClient, type TestMessage } from './harness.js';

function proposalSanIs(san: string) {
  return (m: TestMessage) => (m.proposal as { san?: string } | null)?.san === san;
}

/**
 * `propose` -> `proposal_update` (both teammates) -> `accept` -> `move_committed`
 * (everyone), asserting at each step that the opposing team's sockets never see
 * this move's `proposal_update` (the T-20 🔒 leak requirement — `expectNever` is
 * scoped to *this move's* SAN via `proposalSanIs`, not "any proposal_update ever",
 * since the opposing team legitimately gets their own team-scoped updates too).
 */
async function proposeAndAccept(
  proposer: TestClient,
  teammate: TestClient,
  opponents: readonly TestClient[],
  from: string,
  to: string,
  san: string,
): Promise<void> {
  proposer.send({ t: 'propose', from, to });
  const matches = proposalSanIs(san);
  const [update] = await Promise.all([
    teammate.expect('proposal_update', matches),
    proposer.expect('proposal_update', matches),
    ...opponents.map((c) => c.expectNever('proposal_update', { within: 200, predicate: matches })),
  ]);
  const proposalId = (update.proposal as { id: string }).id;

  teammate.send({ t: 'accept', proposalId });
  await Promise.all([proposer, teammate, ...opponents].map((c) => c.expect('move_committed', (m) => m.san === san)));
}

describe('proposal UI wiring (T-20)', () => {
  it('plays a full 2v2 game to checkmate through propose/accept, never leaking proposal_update across teams', async () => {
    const room = await spawnRoom({ code: 'GM9AFA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    // 1. f3 e5 2. g4 Qh4# — Fool's Mate, each half-move proposed by one
    // teammate and accepted by the other. Move 3 is proposed by carol (not
    // alice, who proposed move 1) to prove either teammate may propose —
    // §4.3 rule 4, "counter-proposing is just proposing" — not just whoever
    // happened to go first.
    await proposeAndAccept(alice, carol, [bob, dave], 'f2', 'f3', 'f3');
    await proposeAndAccept(bob, dave, [alice, carol], 'e7', 'e5', 'e5');
    await proposeAndAccept(carol, alice, [bob, dave], 'g2', 'g4', 'g4');
    await proposeAndAccept(dave, bob, [alice, carol], 'd8', 'h4', 'Qh4#');

    const gameOver = await alice.expect('game_over');
    expect(gameOver).toMatchObject({ status: 'CHECKMATE', winner: 'BLACK' });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('CHECKMATE');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it('withdraw and reject clear the slot without committing, staying team-scoped', async () => {
    const room = await spawnRoom({ code: 'GM9AFB' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    // Reject: carol (accepter) rejects alice's proposal — slot clears, no commit.
    alice.send({ t: 'propose', from: 'f2', to: 'f3' });
    const proposed = await carol.expect('proposal_update', proposalSanIs('f3'));
    const rejectedId = (proposed.proposal as { id: string }).id;

    carol.send({ t: 'reject', proposalId: rejectedId });
    await Promise.all([
      alice.expect('proposal_update', (m) => m.proposal === null),
      carol.expect('proposal_update', (m) => m.proposal === null),
      bob.expectNever('proposal_update', { within: 200, predicate: (m) => m.proposal !== null }),
      dave.expectNever('proposal_update', { within: 200, predicate: (m) => m.proposal !== null }),
    ]);
    await alice.expectNever('move_committed', { within: 200 });

    // Withdraw: alice re-proposes a different move, then withdraws it herself.
    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    const reproposed = await carol.expect('proposal_update', proposalSanIs('e4'));
    const withdrawnId = (reproposed.proposal as { id: string }).id;

    alice.send({ t: 'withdraw', proposalId: withdrawnId });
    await Promise.all([
      alice.expect('proposal_update', (m) => m.proposal === null),
      carol.expect('proposal_update', (m) => m.proposal === null),
    ]);
    await alice.expectNever('move_committed', { within: 200 });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.proposals.WHITE).toBeNull();
    expect(snapshot.room?.game?.fen).toContain(' w '); // no move ever committed

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });
});
