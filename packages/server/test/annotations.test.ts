import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestMessage } from './harness.js';

function annotationSquares(m: TestMessage): string[] {
  return (m.annotations as Array<{ from: string }>).map((a) => a.from);
}

describe('board annotations (T-22)', () => {
  it('reaches the teammate only — expectNever on both opponents and a spectator', async () => {
    const room = await spawnRoom({ code: 'AN9AAA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE (alice's teammate)
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' }); // 5th joiner -> spectator (§5.7)
    await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    alice.send({ t: 'annotate', annotations: [{ kind: 'CIRCLE', from: 'e4', color: 'A' }] });
    await Promise.all([
      alice.expect('annotation_update', (m) => annotationSquares(m).includes('e4')),
      carol.expect('annotation_update', (m) => annotationSquares(m).includes('e4')),
      bob.expectNever('annotation_update', { within: 250 }),
      dave.expectNever('annotation_update', { within: 250 }),
      eve.expectNever('annotation_update', { within: 250 }),
    ]);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('is a full replacement of the sender\'s own set, ignores the wire color, and clears on the next commit', async () => {
    const room = await spawnRoom({ code: 'AN9AAB' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE, first on the team -> color 'A'
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' }); // WHITE, second on the team -> color 'B'
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    // Alice claims color 'B' on the wire — the server must record 'A' (seat-order derived), not
    // trust this. Carol draws her own circle separately.
    alice.send({ t: 'annotate', annotations: [{ kind: 'CIRCLE', from: 'e4', color: 'B' }] });
    await carol.expect('annotation_update', (m) => annotationSquares(m).includes('e4'));
    carol.send({ t: 'annotate', annotations: [{ kind: 'CIRCLE', from: 'g7', color: 'A' }] });
    await alice.expect('annotation_update', (m) => annotationSquares(m).includes('g7'));

    let snapshot = await room.debugState();
    expect(snapshot.room?.game?.annotations.WHITE).toEqual(
      expect.arrayContaining([
        { by: expect.any(String), kind: 'CIRCLE', from: 'e4', color: 'A' },
        { by: expect.any(String), kind: 'CIRCLE', from: 'g7', color: 'B' },
      ]),
    );

    // Alice replaces her own set — carol's circle must survive untouched.
    alice.send({ t: 'annotate', annotations: [{ kind: 'ARROW', from: 'd2', to: 'd4', color: 'A' }] });
    await carol.expect('annotation_update', (m) => annotationSquares(m).includes('d2'));
    snapshot = await room.debugState();
    expect(snapshot.room?.game?.annotations.WHITE).toHaveLength(2);
    expect(snapshot.room?.game?.annotations.WHITE?.some((a) => a.from === 'g7')).toBe(true);
    expect(snapshot.room?.game?.annotations.WHITE?.some((a) => a.from === 'e4')).toBe(false);

    // A committed move clears annotations for both teams (§4.3 rule 7 / §5.9).
    alice.send({ t: 'propose', from: 'f2', to: 'f3' });
    const proposed = await carol.expect('proposal_update', (m) => (m.proposal as { san?: string } | null)?.san === 'f3');
    const proposalId = (proposed.proposal as { id: string }).id;
    carol.send({ t: 'accept', proposalId });
    await alice.expect('move_committed', (m) => m.san === 'f3');

    snapshot = await room.debugState();
    expect(snapshot.room?.game?.annotations).toEqual({ WHITE: [], BLACK: [] });

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });
});
