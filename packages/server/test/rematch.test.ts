import { describe, expect, it } from 'vitest';
import { startOneVOneGame } from './gameSetup.js';
import { spawnRoom } from './harness.js';

describe('rematch (T-26 §5.6)', () => {
  it('a resignation moves the room to FINISHED, and any player (not just the host) can rematch back to TEAM_SELECT', async () => {
    const room = await spawnRoom({ code: 'GM9ARA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    await startOneVOneGame(alice, bob);

    alice.send({ t: 'vote', kind: 'RESIGN' });
    await bob.expect('game_over', (m) => m.status === 'RESIGNED');

    // `TestClient.expect` scans the client's *entire* message history for the first match, not
    // just newly-arrived ones — so a bare `phase === 'TEAM_SELECT'` predicate below would
    // actually resolve with the room's *original* pre-game TEAM_SELECT `state` (team: null for
    // both seats), not the post-rematch one. Anchoring on `seq > finishedState.seq` (`seq` is
    // monotonic per room, §7) is what makes "the next state after this point" unambiguous.
    const finishedState = await alice.expect('state', (m) => m.phase === 'FINISHED');
    const finishedSeq = finishedState.seq as number;

    const finished = await room.debugState();
    expect(finished.room?.phase).toBe('FINISHED');

    // bob (not the host) triggers the rematch — §5.6/T-26's own design call: rematch is not host-gated.
    bob.send({ t: 'rematch' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT' && (m.seq as number) > finishedSeq);
    const afterRematch = await bob.expect('state', (m) => m.phase === 'TEAM_SELECT' && (m.seq as number) > finishedSeq);

    expect(afterRematch.game).toBeNull();
    expect((afterRematch.seats as Array<{ team: string | null; ready: boolean }>).map((s) => [s.team, s.ready])).toEqual([
      ['WHITE', false],
      ['BLACK', false],
    ]);

    const snapshot = await room.debugState();
    expect(snapshot.room?.settings).toEqual(finished.room?.settings);

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects rematch outside the FINISHED phase', async () => {
    const room = await spawnRoom({ code: 'GM9ARB' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await startOneVOneGame(alice, bob);

    alice.send({ t: 'rematch', nonce: 'n1' });
    const error = await alice.expect('error', (m) => m.nonce === 'n1');
    expect(error.code).toBe('INVALID_PHASE');

    const snapshot = await room.debugState();
    expect(snapshot.room?.phase).toBe('IN_GAME');

    alice.disconnect();
    bob.disconnect();
  });
});
