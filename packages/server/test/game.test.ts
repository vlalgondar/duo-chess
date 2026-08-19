import { describe, expect, it } from 'vitest';
import { startOneVOneGame } from './gameSetup.js';
import { spawnRoom } from './harness.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('networked 1v1 (T-14)', () => {
  it('plays a scripted Fool\'s Mate to a server-broadcast checkmate', async () => {
    const room = await spawnRoom({ code: 'GM9AAA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    const bob = await room.connect({ username: 'bob' }); // BLACK
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    await startOneVOneGame(alice, bob);

    alice.send({ t: 'propose', from: 'f2', to: 'f3' });
    await alice.expect('move_committed', (m) => m.san === 'f3');
    await bob.expect('move_committed', (m) => m.san === 'f3');

    bob.send({ t: 'propose', from: 'e7', to: 'e5' });
    await alice.expect('move_committed', (m) => m.san === 'e5');
    await bob.expect('move_committed', (m) => m.san === 'e5');

    alice.send({ t: 'propose', from: 'g2', to: 'g4' });
    await alice.expect('move_committed', (m) => m.san === 'g4');
    await bob.expect('move_committed', (m) => m.san === 'g4');

    bob.send({ t: 'propose', from: 'd8', to: 'h4' });
    await alice.expect('move_committed', (m) => m.san === 'Qh4#');
    await bob.expect('move_committed', (m) => m.san === 'Qh4#');

    const gameOverAlice = await alice.expect('game_over');
    const gameOverBob = await bob.expect('game_over');
    expect(gameOverAlice).toMatchObject({ status: 'CHECKMATE', winner: 'BLACK' });
    expect(gameOverBob).toMatchObject({ status: 'CHECKMATE', winner: 'BLACK' });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.status).toBe('CHECKMATE');

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects an illegal move with ILLEGAL_MOVE, leaving the position unchanged for both', async () => {
    const room = await spawnRoom({ code: 'GM9AAB' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    await startOneVOneGame(alice, bob);

    // A pawn cannot jump from its start square straight to the fourth rank.
    alice.send({ t: 'propose', from: 'e2', to: 'e5' });
    const error = await alice.expect('error');
    expect(error.code).toBe('ILLEGAL_MOVE');

    await alice.expectNever('move_committed', { within: 300 });
    await bob.expectNever('move_committed', { within: 300 });

    const snapshot = await room.debugState();
    expect(snapshot.room?.game?.fen).toBe(START_FEN);

    alice.disconnect();
    bob.disconnect();
  });
});
