import { DEFAULT_ROOM_SETTINGS } from '@duo/shared';
import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestMessage } from './harness.js';

function seatConnection(message: TestMessage, username: string): boolean | undefined {
  const seats = message.seats as Array<{ username: string; connected: boolean }> | undefined;
  return seats?.find((s) => s.username === username)?.connected;
}

describe('reconnection and disconnect grace (T-24)', () => {
  it('a disconnected teammate lets the connected survivor commit directly, without a proposal slot', async () => {
    const room = await spawnRoom({ code: 'RC9AAA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    carol.disconnect();
    await alice.expect('state', (m) => seatConnection(m, 'carol') === false);

    // WHITE is now temporarily solo (§9) — alice's proposal commits directly,
    // with no proposal_update round trip at all.
    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    await alice.expect('move_committed', (m) => m.san === 'e4');
    await bob.expect('move_committed', (m) => m.san === 'e4');
    await dave.expect('move_committed', (m) => m.san === 'e4');

    alice.disconnect();
    bob.disconnect();
    dave.disconnect();
  });

  it("reconnecting within the grace period restores the team's confirmation requirement", async () => {
    const room = await spawnRoom({ code: 'RC9AAB' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    let carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);
    const carolJoined = await carol.expect('state', (m) => typeof m.resumeToken === 'string');
    const carolResumeToken = carolJoined.resumeToken as string;

    await startTwoVTwoGame({ alice, bob, carol, dave });

    carol.disconnect();
    await alice.expect('state', (m) => seatConnection(m, 'carol') === false);

    // WHITE (alice, solo while carol is away) commits directly.
    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    await alice.expect('move_committed', (m) => m.san === 'e4');
    await bob.expect('move_committed', (m) => m.san === 'e4');

    // BLACK is unaffected (both bob and dave connected throughout) — still a
    // real propose/accept round trip.
    bob.send({ t: 'propose', from: 'e7', to: 'e5' });
    const blackUpdate = await dave.expect('proposal_update', (m) => (m.proposal as { san?: string } | null)?.san === 'e5');
    dave.send({ t: 'accept', proposalId: (blackUpdate.proposal as { id: string }).id });
    await alice.expect('move_committed', (m) => m.san === 'e5');
    await bob.expect('move_committed', (m) => m.san === 'e5');

    carol = await room.connect({ username: 'carol', resumeToken: carolResumeToken });
    await alice.expect('state', (m) => seatConnection(m, 'carol') === true);

    // WHITE requires confirmation again — alice's move is a real proposal,
    // not an immediate commit, until carol accepts it.
    alice.send({ t: 'propose', from: 'g1', to: 'f3' });
    const update = await carol.expect('proposal_update', (m) => (m.proposal as { san?: string } | null)?.san === 'Nf3');
    await bob.expectNever('move_committed', { within: 250, predicate: (m) => m.san === 'Nf3' });

    const proposalId = (update.proposal as { id: string }).id;
    carol.send({ t: 'accept', proposalId });
    await alice.expect('move_committed', (m) => m.san === 'Nf3');
    await bob.expect('move_committed', (m) => m.san === 'Nf3');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it(
    'both members of a team disconnected past the grace period end the game as ABANDONED, opponent wins',
    async () => {
      const room = await spawnRoom({ code: 'RC9AAC' });
      const alice = await room.connect({ username: 'alice' }); // host -> WHITE
      const bob = await room.connect({ username: 'bob' }); // BLACK
      const carol = await room.connect({ username: 'carol' }); // WHITE
      const dave = await room.connect({ username: 'dave' }); // BLACK
      await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

      // Host-only, pre-game: a short real grace period so the DO alarm fires
      // for real within the test's timeout, same precedent T-16 used for a
      // short real time control rather than forcing the alarm.
      alice.send({ t: 'update_settings', settings: { ...DEFAULT_ROOM_SETTINGS, disconnectGraceMs: 300 } });
      await alice.expect('state', (m) => (m.settings as { disconnectGraceMs: number }).disconnectGraceMs === 300);

      await startTwoVTwoGame({ alice, bob, carol, dave });

      // Both of BLACK's seats go dark — WHITE (alice/carol) stays connected.
      bob.disconnect();
      dave.disconnect();

      const aliceOver = await alice.expect('game_over', () => true, { timeout: 4_000 });
      const carolOver = await carol.expect('game_over', () => true, { timeout: 4_000 });
      expect(aliceOver).toMatchObject({ status: 'ABANDONED', winner: 'WHITE' });
      expect(carolOver).toMatchObject({ status: 'ABANDONED', winner: 'WHITE' });

      const snapshot = await room.debugState();
      expect(snapshot.room?.game?.status).toBe('ABANDONED');
      expect(snapshot.room?.game?.winner).toBe('WHITE');
      expect(snapshot.room?.game?.clock.running).toBe(false);

      alice.disconnect();
      carol.disconnect();
    },
    8_000,
  );

  it('a reconnecting client receives a full, caught-up state after missing several structural changes', async () => {
    const room = await spawnRoom({ code: 'RC9AAD' });
    let alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);
    const aliceJoined = await alice.expect('state', (m) => typeof m.resumeToken === 'string');
    const resumeToken = aliceJoined.resumeToken as string;

    await startTwoVTwoGame({ alice, bob, carol, dave });
    const staleState = await alice.expect('state', (m) => m.phase === 'IN_GAME');
    const staleSeq = staleState.seq as number;

    alice.disconnect();
    await bob.expect('state', (m) => seatConnection(m, 'alice') === false);

    // WHITE is solo (carol only) — commits directly.
    carol.send({ t: 'propose', from: 'e2', to: 'e4' });
    await carol.expect('move_committed', (m) => m.san === 'e4');
    await bob.expect('move_committed', (m) => m.san === 'e4');

    // BLACK still has both members connected — a real propose/accept round trip.
    bob.send({ t: 'propose', from: 'e7', to: 'e5' });
    const update = await dave.expect('proposal_update', (m) => (m.proposal as { san?: string } | null)?.san === 'e5');
    dave.send({ t: 'accept', proposalId: (update.proposal as { id: string }).id });
    await bob.expect('move_committed', (m) => m.san === 'e5');
    await dave.expect('move_committed', (m) => m.san === 'e5');

    alice = await room.connect({ username: 'alice', resumeToken });
    const resynced = await alice.expect('state', (m) => m.phase === 'IN_GAME');

    // More than one structural broadcast happened while alice was gone
    // (her own disconnect, carol's commit, bob's propose, dave's accept) —
    // a genuine gap, not just the next sequential state.
    expect(resynced.seq as number).toBeGreaterThan(staleSeq + 1);
    expect((resynced.game as { moveHistory: string[] }).moveHistory).toEqual(['e4', 'e5']);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });
});
