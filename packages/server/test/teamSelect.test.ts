import { describe, expect, it } from 'vitest';
import { spawnRoom } from './harness.js';

interface TestSeat {
  readonly username: string;
  readonly team: string | null;
  readonly ready: boolean;
}

describe('team select (T-17)', () => {
  it('rejects a forged set_team into an already-full team, server-side', async () => {
    const room = await spawnRoom({ code: 'GM9ADA' });
    const alice = await room.connect({ username: 'alice' }); // host
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
    const carol = await room.connect({ username: 'carol' });
    await carol.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);

    alice.send({ t: 'start_game' }); // LOBBY -> TEAM_SELECT
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await carol.expect('state', (m) => m.phase === 'TEAM_SELECT');

    alice.send({ t: 'set_team', team: 'WHITE' });
    await alice.expect('state', (m) => (m.seats as TestSeat[]).filter((s) => s.team === 'WHITE').length === 1);
    bob.send({ t: 'set_team', team: 'WHITE' });
    await bob.expect('state', (m) => (m.seats as TestSeat[]).filter((s) => s.team === 'WHITE').length === 2);
    await carol.expect('state', (m) => (m.seats as TestSeat[]).filter((s) => s.team === 'WHITE').length === 2);

    // WHITE is already full (alice, bob) — carol's attempt must be refused server-side.
    carol.send({ t: 'set_team', team: 'WHITE' });
    const error = await carol.expect('error');
    expect(error.code).toBe('TEAM_FULL');

    const snapshot = await room.debugState();
    expect(snapshot.room?.seats.find((s) => s.username === 'carol')?.team).toBeNull();
    expect(snapshot.room?.seats.filter((s) => s.team === 'WHITE')).toHaveLength(2);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
  });

  it('rejects set_team and set_ready once a game has started (mid-game team hopping)', async () => {
    const room = await spawnRoom({ code: 'GM9ADB' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    await bob.expect('state', (m) => (m.seats as TestSeat[]).every((s) => s.team !== null));
    alice.send({ t: 'set_ready', ready: true });
    bob.send({ t: 'set_ready', ready: true });
    await bob.expect('state', (m) => (m.seats as TestSeat[]).every((s) => s.ready));
    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'IN_GAME');
    await bob.expect('state', (m) => m.phase === 'IN_GAME');

    // Bob tries to defect to WHITE mid-game — must be refused, not silently applied.
    bob.send({ t: 'set_team', team: 'WHITE' });
    const teamError = await bob.expect('error');
    expect(teamError.code).toBe('INVALID_PHASE');

    bob.send({ t: 'set_ready', ready: false });
    const readyError = await bob.expect('error');
    expect(readyError.code).toBe('INVALID_PHASE');

    const snapshot = await room.debugState();
    expect(snapshot.room?.seats.find((s) => s.username === 'bob')?.team).toBe('BLACK');

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects randomize_teams from a non-host', async () => {
    const room = await spawnRoom({ code: 'GM9ADC' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');

    bob.send({ t: 'randomize_teams' });
    const error = await bob.expect('error');
    expect(error.code).toBe('NOT_HOST');

    alice.disconnect();
    bob.disconnect();
  });

  it('randomize_teams (host) assigns every seat a team and propagates to everyone', async () => {
    const room = await spawnRoom({ code: 'GM9ADE' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');

    alice.send({ t: 'randomize_teams' });
    await alice.expect('state', (m) => (m.seats as TestSeat[]).every((s) => s.team !== null));
    await bob.expect('state', (m) => (m.seats as TestSeat[]).every((s) => s.team !== null));

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects back_to_lobby from a non-host', async () => {
    const room = await spawnRoom({ code: 'GM9ADF' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');

    bob.send({ t: 'back_to_lobby' });
    const error = await bob.expect('error');
    expect(error.code).toBe('NOT_HOST');

    alice.disconnect();
    bob.disconnect();
  });

  it('back_to_lobby (host) returns TEAM_SELECT to LOBBY, clearing team picks and ready state', async () => {
    const room = await spawnRoom({ code: 'GM9ADG' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');

    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    alice.send({ t: 'set_ready', ready: true });
    bob.send({ t: 'set_ready', ready: true });
    await bob.expect('state', (m) => (m.seats as TestSeat[]).every((s) => s.ready));

    alice.send({ t: 'back_to_lobby' });
    const aliceState = await alice.expect('state', (m) => m.phase === 'LOBBY');
    expect((aliceState.seats as TestSeat[]).every((s) => s.team === null && !s.ready)).toBe(true);
    await bob.expect(
      'state',
      (m) => m.phase === 'LOBBY' && (m.seats as TestSeat[]).every((s) => s.team === null && !s.ready),
    );

    // The room still works from here — the host can send everyone back to Team Select.
    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects back_to_lobby outside TEAM_SELECT', async () => {
    const room = await spawnRoom({ code: 'GM9ADH' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    alice.send({ t: 'back_to_lobby' });
    const error = await alice.expect('error');
    expect(error.code).toBe('INVALID_PHASE');

    alice.disconnect();
  });
});
